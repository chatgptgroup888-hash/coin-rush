import { redis, keys } from '../db/redis';

/**
 * Fixed-window rate limiter backed by Redis.
 * Works across multiple server instances because the counter lives in Redis.
 * Returns true if the request is allowed.
 */
export async function allowRequest(
  bucket: string,
  id: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const key = keys.rateLimit(bucket, id);
  const [[, count]] = (await redis.multi().incr(key).expire(key, windowSec, 'NX').exec()) as [
    [Error | null, number],
    [Error | null, number],
  ];
  return count <= limit;
}
