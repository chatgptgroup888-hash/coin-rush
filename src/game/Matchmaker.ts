import { randomUUID } from 'node:crypto';
import { redis, keys } from '../db/redis';
import { logger } from '../utils/logger';
import { findGroups, type QueueEntry } from './matching';

/** Removes all given players from the queue ONLY if every one is still queued (atomic). */
const CLAIM_SCRIPT = `
for _, id in ipairs(ARGV) do
  if redis.call('ZSCORE', KEYS[1], id) == false then return 0 end
end
for _, id in ipairs(ARGV) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('HDEL', KEYS[2], id)
end
return 1
`;

/** Release the lock only if we still own it. */
const UNLOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

/**
 * Matchmaking queue stored in Redis:
 *   mm:queue      ZSET  playerId -> rating
 *   mm:joined_at  HASH  playerId -> epoch ms
 * A short-lived distributed lock (SET NX PX) makes sure only one
 * matchmaking pass runs at a time, even with several server instances.
 */
export class Matchmaker {
  private timer: NodeJS.Timeout | null = null;
  private readonly instanceId = randomUUID();

  constructor(
    private readonly groupSize: number,
    private readonly onMatch: (playerIds: string[]) => Promise<void>,
    private readonly intervalMs = 1000,
  ) {}

  async join(playerId: string, rating: number): Promise<number> {
    await redis
      .multi()
      .zadd(keys.mmQueue, rating, playerId)
      .hsetnx(keys.mmJoinedAt, playerId, Date.now().toString())
      .exec();
    return redis.zcard(keys.mmQueue);
  }

  async leave(playerId: string): Promise<void> {
    await redis.multi().zrem(keys.mmQueue, playerId).hdel(keys.mmJoinedAt, playerId).exec();
  }

  async isQueued(playerId: string): Promise<boolean> {
    return (await redis.zscore(keys.mmQueue, playerId)) !== null;
  }

  start(): void {
    this.timer = setInterval(() => {
      this.tick().catch((err) => logger.error('Matchmaker tick failed', { err: err.message }));
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    const locked = await redis.set(keys.mmLock, this.instanceId, 'PX', this.intervalMs, 'NX');
    if (!locked) return;

    try {
      const raw = await redis.zrange(keys.mmQueue, 0, -1, 'WITHSCORES');
      if (raw.length / 2 < this.groupSize) return;

      const joined = await redis.hgetall(keys.mmJoinedAt);
      const now = Date.now();
      const entries: QueueEntry[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        const id = raw[i];
        entries.push({ id, rating: Number(raw[i + 1]), waitMs: now - Number(joined[id] ?? now) });
      }

      for (const group of findGroups(entries, this.groupSize)) {
        const claimed = await redis.eval(CLAIM_SCRIPT, 2, keys.mmQueue, keys.mmJoinedAt, ...group);
        if (claimed === 1) {
          logger.info('Match formed', { players: group });
          await this.onMatch(group);
        }
      }
    } finally {
      await redis.eval(UNLOCK_SCRIPT, 1, keys.mmLock, this.instanceId);
    }
  }

  /** On boot, drop stale queue entries left from a previous crash. */
  async reset(): Promise<void> {
    await redis.del(keys.mmQueue, keys.mmJoinedAt, keys.mmLock);
  }
}
