import type { CoinState, MatchPlayerResult, PlayerState, Send, ServerMessage } from './types';

export interface RoomOptions {
  tickRate: number;       // server simulation ticks per second
  durationMs: number;     // match length
  width?: number;
  height?: number;
  coinCount?: number;
  speed?: number;         // px per second
  rng?: () => number;     // injectable for deterministic tests
  now?: () => number;
}

export interface RoomEndSummary {
  matchId: string;
  startedAt: Date;
  endedAt: Date;
  winnerId: string | null;
  results: MatchPlayerResult[];
}

interface RoomPlayer extends PlayerState {
  dx: number;
  dy: number;
  lastSeq: number;
  send: Send | null;
}

export const PLAYER_RADIUS = 16;
export const COIN_RADIUS = 8;

/**
 * One running match. The server is AUTHORITATIVE:
 *  - clients only send an input direction, never a position
 *  - the server moves players, detects coin pickups and keeps score
 *  - every tick a snapshot is broadcast to all players
 */
export class GameRoom {
  readonly width: number;
  readonly height: number;
  readonly startedAt: Date;
  private readonly players = new Map<string, RoomPlayer>();
  private coins: CoinState[] = [];
  private nextCoinId = 1;
  private tick = 0;
  private elapsedMs = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private finished = false;
  private readonly rng: () => number;
  private readonly now: () => number;
  private readonly speed: number;

  constructor(
    readonly id: string,
    roster: { id: string; username: string }[],
    private readonly opts: RoomOptions,
    private readonly onEnd: (summary: RoomEndSummary) => void | Promise<void>,
  ) {
    this.width = opts.width ?? 800;
    this.height = opts.height ?? 600;
    this.speed = opts.speed ?? 200;
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.startedAt = new Date(this.now());

    // Spread spawn points evenly around the centre
    roster.forEach((p, i) => {
      const angle = (2 * Math.PI * i) / roster.length;
      this.players.set(p.id, {
        id: p.id,
        username: p.username,
        x: this.width / 2 + Math.cos(angle) * 200,
        y: this.height / 2 + Math.sin(angle) * 150,
        score: 0,
        connected: false,
        dx: 0,
        dy: 0,
        lastSeq: 0,
        send: null,
      });
    });

    for (let i = 0; i < (opts.coinCount ?? 5); i++) this.coins.push(this.spawnCoin());
  }

  /* ---------------- lifecycle ---------------- */

  start(): void {
    this.lastTickAt = this.now();
    this.timer = setInterval(() => {
      const t = this.now();
      const dt = t - this.lastTickAt;
      this.lastTickAt = t;
      this.step(dt);
    }, 1000 / this.opts.tickRate);
  }

  /** Advance the simulation by dtMs. Public so tests can drive it without timers. */
  step(dtMs: number): void {
    if (this.finished) return;
    this.tick++;
    this.elapsedMs += dtMs;
    const dt = dtMs / 1000;

    for (const p of this.players.values()) {
      p.x = clamp(p.x + p.dx * this.speed * dt, PLAYER_RADIUS, this.width - PLAYER_RADIUS);
      p.y = clamp(p.y + p.dy * this.speed * dt, PLAYER_RADIUS, this.height - PLAYER_RADIUS);

      // Coin pickup (circle-circle collision)
      this.coins = this.coins.map((c) => {
        if (Math.hypot(p.x - c.x, p.y - c.y) <= PLAYER_RADIUS + COIN_RADIUS) {
          p.score++;
          return this.spawnCoin();
        }
        return c;
      });
    }

    this.broadcastState();

    if (this.elapsedMs >= this.opts.durationMs) void this.finish();
  }

  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    const results: MatchPlayerResult[] = [...this.players.values()]
      .map((p) => ({ playerId: p.id, username: p.username, score: p.score }))
      .sort((a, b) => b.score - a.score);

    const winnerId =
      results.length > 1 && results[0].score === results[1].score ? null : results[0]?.playerId ?? null;

    await this.onEnd({
      matchId: this.id,
      startedAt: this.startedAt,
      endedAt: new Date(this.now()),
      winnerId,
      results,
    });
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /* ---------------- players ---------------- */

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  attach(playerId: string, send: Send): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.send = send;
    p.connected = true;
  }

  detach(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.send = null;
    p.connected = false;
    p.dx = 0; // stop moving while disconnected
    p.dy = 0;
  }

  handleInput(playerId: string, seq: number, dx: number, dy: number): void {
    const p = this.players.get(playerId);
    if (!p || this.finished) return;
    if (seq <= p.lastSeq) return; // drop out-of-order / replayed packets

    // Normalise so diagonal movement is not faster (anti-cheat)
    const len = Math.hypot(dx, dy);
    p.dx = len > 1 ? dx / len : dx;
    p.dy = len > 1 ? dy / len : dy;
    p.lastSeq = seq;
  }

  /* ---------------- messaging ---------------- */

  broadcast(msg: ServerMessage): void {
    for (const p of this.players.values()) p.send?.(msg);
  }

  snapshot() {
    return {
      tick: this.tick,
      timeLeftMs: Math.max(0, this.opts.durationMs - this.elapsedMs),
      players: [...this.players.values()].map(({ id, username, x, y, score, connected }) => ({
        id,
        username,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        score,
        connected,
      })),
      coins: this.coins.map((c) => ({ ...c })),
    };
  }

  private broadcastState(): void {
    const snap = this.snapshot();
    for (const p of this.players.values()) {
      p.send?.({ type: 'state', ...snap, lastProcessedSeq: p.lastSeq });
    }
  }

  private spawnCoin(): CoinState {
    const m = 40;
    return {
      id: this.nextCoinId++,
      x: Math.round(m + this.rng() * (this.width - 2 * m)),
      y: Math.round(m + this.rng() * (this.height - 2 * m)),
    };
  }

  /** Test helper: put a coin at an exact position. */
  _placeCoin(x: number, y: number): void {
    this.coins = [{ id: this.nextCoinId++, x, y }];
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
