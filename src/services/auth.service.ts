import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { pool } from '../db/postgres';
import { redis, keys } from '../db/redis';
import { conflict, unauthorized } from '../utils/errors';

export interface TokenPayload {
  sub: string; // player id
  username: string;
}

export interface PublicPlayer {
  id: string;
  username: string;
  rating: number;
}

export interface AuthResult {
  player: PublicPlayer;
  token: string;        // access token (JWT อายุสั้น ใช้เรียก API / ต่อ WebSocket)
  refreshToken: string; // ใช้ขอ access token ใหม่ (อายุยาว เก็บใน Redis)
}

/* ---------------- Access token (JWT) ---------------- */

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    return { sub: String(decoded.sub), username: String(decoded.username) };
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

/* ---------------- Refresh token (สุ่ม + เก็บใน Redis) ---------------- */

async function issueRefreshToken(playerId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const ttl = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
  await redis
    .multi()
    .set(keys.refresh(token), playerId, 'EX', ttl)
    .sadd(keys.playerRefresh(playerId), token)
    .expire(keys.playerRefresh(playerId), ttl)
    .exec();
  return token;
}

async function buildAuthResult(player: PublicPlayer): Promise<AuthResult> {
  return {
    player,
    token: signToken({ sub: player.id, username: player.username }),
    refreshToken: await issueRefreshToken(player.id),
  };
}

/** แลก refresh token เก่า → ได้ access token + refresh token ใหม่ (rotation: ตัวเก่าใช้ซ้ำไม่ได้) */
export async function refresh(refreshToken: string): Promise<AuthResult> {
  // GETDEL = อ่านแล้วลบในคำสั่งเดียว (atomic) กันการใช้ token เดิมซ้ำพร้อมกัน 2 ครั้ง
  const playerId = await redis.getdel(keys.refresh(refreshToken));
  if (!playerId) throw unauthorized('Invalid or expired refresh token');
  await redis.srem(keys.playerRefresh(playerId), refreshToken);

  const { rows } = await pool.query<PublicPlayer>(
    'SELECT id, username, rating FROM players WHERE id = $1',
    [playerId],
  );
  if (!rows[0]) throw unauthorized('Player no longer exists');
  return buildAuthResult(rows[0]);
}

/** ออกจากระบบ: ทำให้ refresh token ใช้ไม่ได้อีก */
export async function logout(refreshToken: string): Promise<void> {
  const playerId = await redis.getdel(keys.refresh(refreshToken));
  if (playerId) await redis.srem(keys.playerRefresh(playerId), refreshToken);
}

/** ยกเลิก refresh token ทุกเครื่องของผู้เล่น (ใช้ตอนเปลี่ยนรหัสผ่าน / ลบบัญชี) */
export async function revokeAllRefreshTokens(playerId: string): Promise<void> {
  const tokens = await redis.smembers(keys.playerRefresh(playerId));
  const pipeline = redis.pipeline();
  for (const t of tokens) pipeline.del(keys.refresh(t));
  pipeline.del(keys.playerRefresh(playerId));
  await pipeline.exec();
}

/* ---------------- Register / Login ---------------- */

export async function register(username: string, password: string): Promise<AuthResult> {
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query<PublicPlayer>(
      `INSERT INTO players (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, rating`,
      [username, hash],
    );
    const player = rows[0];
    // New players appear on the leaderboard immediately
    await redis.zadd(keys.leaderboard, player.rating, player.id);
    return buildAuthResult(player);
  } catch (err: any) {
    if (err.code === '23505') throw conflict('Username already taken'); // unique_violation
    throw err;
  }
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const { rows } = await pool.query<PublicPlayer & { password_hash: string }>(
    'SELECT id, username, rating, password_hash FROM players WHERE username = $1',
    [username],
  );
  const row = rows[0];
  // Same error for "no user" and "wrong password" so usernames cannot be enumerated
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw unauthorized('Invalid username or password');
  }
  return buildAuthResult({ id: row.id, username: row.username, rating: row.rating });
}
