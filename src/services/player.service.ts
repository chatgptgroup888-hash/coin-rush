import { pool, withTransaction } from '../db/postgres';
import { redis, keys } from '../db/redis';
import bcrypt from 'bcryptjs';
import { conflict, notFound } from '../utils/errors';
import { revokeAllRefreshTokens } from './auth.service';
import { calculateElo } from './elo';

export interface MatchResultInput {
  matchId: string;
  startedAt: Date;
  endedAt: Date;
  scores: { playerId: string; score: number }[];
}

export interface MatchResultOutput {
  playerId: string;
  score: number;
  ratingBefore: number;
  ratingAfter: number;
}

export async function getProfile(playerId: string) {
  const { rows } = await pool.query(
    `SELECT id, username, rating, games_played, wins, created_at
       FROM players WHERE id = $1`,
    [playerId],
  );
  if (!rows[0]) throw notFound('Player not found');
  const rank = await redis.zrevrank(keys.leaderboard, playerId);
  return { ...rows[0], rank: rank === null ? null : rank + 1 };
}

export async function getRating(playerId: string): Promise<number> {
  const { rows } = await pool.query<{ rating: number }>(
    'SELECT rating FROM players WHERE id = $1',
    [playerId],
  );
  if (!rows[0]) throw notFound('Player not found');
  return rows[0].rating;
}

/**
 * Leaderboard is served from a Redis sorted set (O(log N) reads),
 * then enriched with usernames from Postgres in one query.
 */
export async function getLeaderboard(limit = 10, offset = 0) {
  const raw = await redis.zrevrange(keys.leaderboard, offset, offset + limit - 1, 'WITHSCORES');
  const entries: { playerId: string; rating: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({ playerId: raw[i], rating: Number(raw[i + 1]) });
  }
  if (entries.length === 0) return [];

  const { rows } = await pool.query<{ id: string; username: string }>(
    'SELECT id, username FROM players WHERE id = ANY($1::uuid[])',
    [entries.map((e) => e.playerId)],
  );
  const names = new Map(rows.map((r) => [r.id, r.username]));

  return entries.map((e, i) => ({
    rank: offset + i + 1,
    playerId: e.playerId,
    username: names.get(e.playerId) ?? 'unknown',
    rating: e.rating,
  }));
}

/** Rebuild the Redis leaderboard from Postgres (source of truth) — run on startup. */
export async function syncLeaderboard(): Promise<number> {
  const { rows } = await pool.query<{ id: string; rating: number }>('SELECT id, rating FROM players');
  if (rows.length === 0) return 0;
  const args = rows.flatMap((r) => [r.rating, r.id]);
  await redis.zadd(keys.leaderboard, ...args);
  return rows.length;
}

export async function getMatchHistory(playerId: string, limit = 20) {
  const { rows } = await pool.query(
    `SELECT m.id AS match_id, m.started_at, m.ended_at,
            mp.score, mp.rating_before, mp.rating_after,
            (m.winner_id = $1) AS won
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
      WHERE mp.player_id = $1
      ORDER BY m.ended_at DESC
      LIMIT $2`,
    [playerId, limit],
  );
  return rows;
}

/**
 * Persist a finished match atomically:
 *  - lock the players' rows (FOR UPDATE) so concurrent matches can't race on rating
 *  - compute new Elo, write match + per-player rows, update player stats
 *  - after COMMIT, update the Redis leaderboard
 */
export async function saveMatchResult(input: MatchResultInput): Promise<MatchResultOutput[]> {
  const results = await withTransaction(async (c) => {
    const ids = input.scores.map((s) => s.playerId);
    const { rows } = await c.query<{ id: string; rating: number }>(
      'SELECT id, rating FROM players WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [ids],
    );
    const ratingOf = new Map(rows.map((r) => [r.id, r.rating]));

    const eloInput = input.scores.map((s) => ({
      playerId: s.playerId,
      score: s.score,
      rating: ratingOf.get(s.playerId) ?? 1000,
    }));
    const newRatings = calculateElo(eloInput);

    // Winner = single highest score; a tie at the top means no winner
    const sorted = [...input.scores].sort((a, b) => b.score - a.score);
    const winnerId =
      sorted.length > 1 && sorted[0].score === sorted[1].score ? null : sorted[0]?.playerId ?? null;

    await c.query(
      'INSERT INTO matches (id, started_at, ended_at, winner_id) VALUES ($1, $2, $3, $4)',
      [input.matchId, input.startedAt, input.endedAt, winnerId],
    );

    const out: MatchResultOutput[] = [];
    for (const p of eloInput) {
      const after = newRatings.get(p.playerId)!;
      await c.query(
        `INSERT INTO match_players (match_id, player_id, score, rating_before, rating_after)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.matchId, p.playerId, p.score, p.rating, after],
      );
      await c.query(
        `UPDATE players
            SET rating = $2,
                games_played = games_played + 1,
                wins = wins + CASE WHEN $3 THEN 1 ELSE 0 END
          WHERE id = $1`,
        [p.playerId, after, p.playerId === winnerId],
      );
      out.push({ playerId: p.playerId, score: p.score, ratingBefore: p.rating, ratingAfter: after });
    }
    return out;
  });

  // Cache update happens only after the DB commit succeeded
  const pipeline = redis.pipeline();
  for (const r of results) pipeline.zadd(keys.leaderboard, r.ratingAfter, r.playerId);
  await pipeline.exec();

  return results;
}

/**
 * UPDATE: แก้ username และ/หรือ password ของตัวเอง
 * เปลี่ยนรหัสผ่านแล้วจะ logout ทุกเครื่อง (ยกเลิก refresh token ทั้งหมด)
 */
export async function updateAccount(
  playerId: string,
  changes: { username?: string; password?: string },
) {
  const hash = changes.password ? await bcrypt.hash(changes.password, 10) : null;
  try {
    const { rows } = await pool.query(
      `UPDATE players
          SET username      = COALESCE($2, username),
              password_hash = COALESCE($3, password_hash)
        WHERE id = $1
        RETURNING id, username, rating, games_played, wins, created_at`,
      [playerId, changes.username ?? null, hash],
    );
    if (!rows[0]) throw notFound('Player not found');
    if (hash) await revokeAllRefreshTokens(playerId);
    return rows[0];
  } catch (err: any) {
    if (err.code === '23505') throw conflict('Username already taken');
    throw err;
  }
}

/**
 * DELETE: ลบบัญชีของตัวเอง
 * Postgres ลบผลแข่งที่เกี่ยวข้องให้เองด้วย ON DELETE CASCADE (migration 002)
 * จากนั้นล้างข้อมูลใน Redis: leaderboard, คิวจับคู่, refresh token
 */
export async function deleteAccount(playerId: string): Promise<void> {
  const { rowCount } = await pool.query('DELETE FROM players WHERE id = $1', [playerId]);
  if (rowCount === 0) throw notFound('Player not found');
  await redis
    .multi()
    .zrem(keys.leaderboard, playerId)
    .zrem(keys.mmQueue, playerId)
    .hdel(keys.mmJoinedAt, playerId)
    .exec();
  await revokeAllRefreshTokens(playerId);
}
