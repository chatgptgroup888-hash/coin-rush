import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/** Main client for commands (GET/SET/ZADD/...) */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });

redis.on('error', (err) => logger.error('Redis error', { err: err.message }));

/** All Redis keys live here so they are easy to find and never collide. */
export const keys = {
  leaderboard: 'leaderboard:rating',          // ZSET  playerId -> rating
  mmQueue: 'mm:queue',                        // ZSET  playerId -> rating
  mmJoinedAt: 'mm:joined_at',                 // HASH  playerId -> epoch ms
  mmLock: 'mm:lock',                          // STRING (distributed lock)
  online: (playerId: string) => `online:${playerId}`,           // STRING w/ TTL
  rateLimit: (bucket: string, id: string) => `rl:${bucket}:${id}`,
  refresh: (token: string) => `refresh:${token}`,              // STRING playerId w/ TTL
  playerRefresh: (playerId: string) => `refresh_of:${playerId}`, // SET of tokens (for logout-all)
};
