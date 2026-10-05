import { pool } from '../db/postgres';

/**
 * GROUP BY #1: จำนวนแมตช์และคะแนนเฉลี่ยต่อวัน (ย้อนหลัง N วัน)
 */
export async function getDailyStats(days = 7) {
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', m.ended_at), 'YYYY-MM-DD') AS day,
            COUNT(DISTINCT m.id)::int                          AS matches,
            COUNT(DISTINCT mp.player_id)::int                  AS players,
            ROUND(AVG(mp.score), 1)::float                     AS avg_score
       FROM matches m
       JOIN match_players mp ON mp.match_id = m.id
      WHERE m.ended_at >= now() - make_interval(days => $1)
      GROUP BY 1
      ORDER BY 1 DESC`,
    [days],
  );
  return rows;
}

/**
 * GROUP BY #2: ผู้เล่นที่ชนะมากที่สุด + win rate (ใช้ JOIN + GROUP BY + HAVING)
 */
export async function getTopWinners(limit = 10) {
  const { rows } = await pool.query(
    `SELECT p.username,
            COUNT(*)::int                                          AS games,
            COUNT(*) FILTER (WHERE m.winner_id = p.id)::int        AS wins,
            ROUND(100.0 * COUNT(*) FILTER (WHERE m.winner_id = p.id) / COUNT(*), 1)::float AS win_rate
       FROM match_players mp
       JOIN players p ON p.id = mp.player_id
       JOIN matches m ON m.id = mp.match_id
      GROUP BY p.id, p.username
     HAVING COUNT(*) > 0
      ORDER BY wins DESC, win_rate DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}
