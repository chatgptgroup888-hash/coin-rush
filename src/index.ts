import http from 'node:http';
import { env } from './config/env';
import { pool, runMigrations } from './db/postgres';
import { redis } from './db/redis';
import { createApp } from './http/app';
import { syncLeaderboard } from './services/player.service';
import { logger } from './utils/logger';
import { createGameSocketServer } from './ws/gameSocket';

async function main() {
  await runMigrations();
  const synced = await syncLeaderboard();
  logger.info('Leaderboard synced from Postgres', { players: synced });

  // HTTP (REST) and WebSocket share one port
  let game: ReturnType<typeof createGameSocketServer>;
  const app = createApp({
    onlinePlayers: () => game?.onlineCount ?? 0,
    activeRooms: () => game?.rooms.activeRooms ?? 0,
  });
  const server = http.createServer(app);
  game = createGameSocketServer(server, env.PLAYERS_PER_MATCH);

  await game.matchmaker.reset();
  game.matchmaker.start();

  server.listen(env.PORT, () => {
    logger.info('Server listening', { port: env.PORT, rest: '/api', ws: '/ws' });
  });

  // Graceful shutdown: finish running matches (results are saved), then close connections
  const shutdown = async (signal: string) => {
    logger.info('Shutting down', { signal });
    server.close();
    await game.close();
    await pool.end();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { err: err.message });
  process.exit(1);
});
