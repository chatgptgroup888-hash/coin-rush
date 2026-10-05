import { describe, expect, it, vi } from 'vitest';
import { GameRoom } from './GameRoom';
import type { ServerMessage } from './types';

const roster = [
  { id: 'p1', username: 'alice' },
  { id: 'p2', username: 'bob' },
];

function makeRoom(onEnd = vi.fn()) {
  return new GameRoom('room-1', roster, { tickRate: 20, durationMs: 1000, rng: () => 0.5, now: () => 0 }, onEnd);
}

describe('GameRoom', () => {
  it('moves a player according to input (server-authoritative)', () => {
    const room = makeRoom();
    const before = room.snapshot().players.find((p) => p.id === 'p1')!;
    room.handleInput('p1', 1, 1, 0);
    room.step(500); // 0.5s at 200px/s = 100px
    const after = room.snapshot().players.find((p) => p.id === 'p1')!;
    expect(after.x - before.x).toBeCloseTo(100, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it('normalises diagonal input so it is not faster than straight input', () => {
    const room = makeRoom();
    const start = room.snapshot().players.find((p) => p.id === 'p2')!; // spawns at the left side
    room.handleInput('p2', 1, 1, 1);
    room.step(250);
    const end = room.snapshot().players.find((p) => p.id === 'p2')!;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    expect(distance).toBeCloseTo(50, 0);
  });

  it('ignores out-of-order input packets', () => {
    const room = makeRoom();
    room.handleInput('p1', 5, 1, 0);
    room.handleInput('p1', 3, -1, 0); // older seq — must be dropped
    const x0 = room.snapshot().players[0].x;
    room.step(100);
    expect(room.snapshot().players[0].x).toBeGreaterThan(x0);
  });

  it('keeps players inside the map', () => {
    const room = makeRoom();
    room.handleInput('p1', 1, 1, 0);
    for (let i = 0; i < 19; i++) room.step(50);
    const p = room.snapshot().players[0];
    expect(p.x).toBeLessThanOrEqual(room.width - 16);
  });

  it('awards a point when a player touches a coin', () => {
    const room = makeRoom();
    const p1 = room.snapshot().players[0];
    room._placeCoin(p1.x, p1.y);
    room.step(10);
    expect(room.snapshot().players[0].score).toBe(1);
  });

  it('broadcasts state to attached players each tick', () => {
    const room = makeRoom();
    const received: ServerMessage[] = [];
    room.attach('p1', (m) => received.push(m));
    room.step(50);
    expect(received[0].type).toBe('state');
  });

  it('ends after the duration and reports the winner', async () => {
    const onEnd = vi.fn();
    const room = makeRoom(onEnd);
    const p1 = room.snapshot().players[0];
    room._placeCoin(p1.x, p1.y);
    room.step(1000);
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledOnce());
    expect(onEnd.mock.calls[0][0].winnerId).toBe('p1');
    expect(room.isFinished).toBe(true);
  });

  it('declares no winner on a tie', async () => {
    const onEnd = vi.fn();
    const room = makeRoom(onEnd);
    room.step(1000);
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledOnce());
    expect(onEnd.mock.calls[0][0].winnerId).toBeNull();
  });
});
