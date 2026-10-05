import path from 'node:path';
import express from 'express';
import { pool } from '../db/postgres';
import { redis } from '../db/redis';
import { ErrorCode } from '../utils/errors';
import { errorHandler } from './middleware';
import { authRouter } from './routes/auth.routes';
import { statsRouter } from './routes/stats.routes';
import { playerRouter } from './routes/player.routes';

export interface RuntimeStats {
  onlinePlayers: () => number;
  activeRooms: () => number;
}

export function createApp(stats: RuntimeStats) {
  const app = express();
  app.set('trust proxy', 1); // behind AWS ALB / nginx: use X-Forwarded-For for req.ip
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.resolve(__dirname, '../../public'))); // browser test client at "/"

  // Liveness + readiness in one: checks both datastores
  app.get('/health', async (_req, res) => {
    const [db, cache] = await Promise.allSettled([pool.query('SELECT 1'), redis.ping()]);
    const ok = db.status === 'fulfilled' && cache.status === 'fulfilled';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      postgres: db.status === 'fulfilled' ? 'up' : 'down',
      redis: cache.status === 'fulfilled' ? 'up' : 'down',
      onlinePlayers: stats.onlinePlayers(),
      activeRooms: stats.activeRooms(),
      uptimeSec: Math.round(process.uptime()),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api', playerRouter);
  app.use('/api', statsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: ErrorCode.NotFound, message: 'Route not found' } });
  });
  app.use(errorHandler);

  return app;
}
