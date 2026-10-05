import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { pool } from '../db/postgres';
import { saveMatchResult } from '../services/player.service';
import { logger } from '../utils/logger';
import { GameRoom, RoomEndSummary } from './GameRoom';
import type { Send } from './types';

/**
 * Owns every running GameRoom on this server instance and knows
 * which room each player is in (needed for reconnects).
 */
export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly playerRoom = new Map<string, string>();

  /** getSender returns the live socket sender for a player, or null if offline. */
  constructor(private readonly getSender: (playerId: string) => Send | null) {}

  async createRoom(playerIds: string[]): Promise<GameRoom> {
    const { rows } = await pool.query<{ id: string; username: string }>(
      'SELECT id, username FROM players WHERE id = ANY($1::uuid[])',
      [playerIds],
    );

    const room: GameRoom = new GameRoom(
      randomUUID(),
      rows,
      { tickRate: env.TICK_RATE, durationMs: env.MATCH_DURATION_SEC * 1000 },
      (summary): Promise<void> => this.handleRoomEnd(room, summary),
    );
    this.rooms.set(room.id, room);

    for (const p of rows) {
      this.playerRoom.set(p.id, room.id);
      const send = this.getSender(p.id);
      if (send) room.attach(p.id, send);
    }

    room.broadcast({
      type: 'match_found',
      matchId: room.id,
      players: rows,
      map: { width: room.width, height: room.height },
      durationSec: env.MATCH_DURATION_SEC,
      tickRate: env.TICK_RATE,
    });
    room.start();
    logger.info('Room started', { roomId: room.id, players: rows.map((r) => r.username) });
    return room;
  }

  getRoomOf(playerId: string): GameRoom | undefined {
    const roomId = this.playerRoom.get(playerId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  /** Called when a socket connects — rejoins an in-progress match if there is one. */
  onPlayerConnected(playerId: string, send: Send): GameRoom | undefined {
    const room = this.getRoomOf(playerId);
    if (!room) return undefined;
    room.attach(playerId, send);
    logger.info('Player reconnected to room', { playerId, roomId: room.id });
    return room;
  }

  /**
   * The player's slot (and score) is kept until the match ends, so a flaky
   * connection doesn't forfeit the game — they can reconnect and continue.
   */
  onPlayerDisconnected(playerId: string): void {
    const room = this.getRoomOf(playerId);
    if (!room) return;
    room.detach(playerId);
    logger.info('Player disconnected from room', { playerId, roomId: room.id });
  }

  get activeRooms(): number {
    return this.rooms.size;
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.rooms.values()].map((r) => r.finish()));
  }

  private async handleRoomEnd(room: GameRoom, summary: RoomEndSummary): Promise<void> {
    let results = summary.results;
    try {
      const saved = await saveMatchResult({
        matchId: summary.matchId,
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        scores: summary.results.map((r) => ({ playerId: r.playerId, score: r.score })),
      });
      const byId = new Map(saved.map((s) => [s.playerId, s]));
      results = summary.results.map((r) => ({
        ...r,
        ratingBefore: byId.get(r.playerId)?.ratingBefore,
        ratingAfter: byId.get(r.playerId)?.ratingAfter,
      }));
    } catch (err: any) {
      logger.error('Failed to save match result', { matchId: summary.matchId, err: err.message });
    }

    room.broadcast({ type: 'match_end', matchId: summary.matchId, winnerId: summary.winnerId, results });

    for (const r of summary.results) {
      this.playerRoom.delete(r.playerId);
    }
    this.rooms.delete(room.id);
    logger.info('Room finished', { roomId: room.id, winnerId: summary.winnerId });
  }
}
