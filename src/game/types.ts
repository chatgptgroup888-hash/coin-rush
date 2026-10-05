import { z } from 'zod';

/* ------------------------------------------------------------------ */
/*  Client → Server messages (validated with zod — never trust input) */
/* ------------------------------------------------------------------ */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('queue_join') }),
  z.object({ type: z.literal('queue_leave') }),
  z.object({
    type: z.literal('input'),
    seq: z.number().int().nonnegative(),
    // direction vector; server clamps & normalises it (anti speed-hack)
    dx: z.number().finite().min(-1).max(1),
    dy: z.number().finite().min(-1).max(1),
  }),
  z.object({ type: z.literal('ping'), t: z.number() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/* ------------------------------------------------------------------ */
/*  Server → Client messages                                          */
/* ------------------------------------------------------------------ */
export interface PlayerState {
  id: string;
  username: string;
  x: number;
  y: number;
  score: number;
  connected: boolean;
}

export interface CoinState {
  id: number;
  x: number;
  y: number;
}

export interface MatchPlayerResult {
  playerId: string;
  username: string;
  score: number;
  ratingBefore?: number;
  ratingAfter?: number;
}

export type ServerMessage =
  | { type: 'welcome'; playerId: string; username: string }
  | { type: 'queue_joined'; position: number }
  | { type: 'queue_left' }
  | {
      type: 'match_found';
      matchId: string;
      players: { id: string; username: string }[];
      map: { width: number; height: number };
      durationSec: number;
      tickRate: number;
    }
  | {
      type: 'state';
      tick: number;
      timeLeftMs: number;
      lastProcessedSeq: number; // for client-side reconciliation
      players: PlayerState[];
      coins: CoinState[];
    }
  | { type: 'match_end'; matchId: string; winnerId: string | null; results: MatchPlayerResult[] }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'error'; code: string; message: string };

export type Send = (msg: ServerMessage) => void;
