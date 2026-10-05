import { describe, expect, it } from 'vitest';
import { calculateElo, expectedScore } from './elo';

describe('expectedScore', () => {
  it('is 0.5 for equal ratings', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
  });

  it('favours the higher-rated player', () => {
    expect(expectedScore(1400, 1000)).toBeGreaterThan(0.9);
  });
});

describe('calculateElo', () => {
  it('winner gains and loser loses the same amount in a 1v1 of equal rating', () => {
    const r = calculateElo([
      { playerId: 'a', rating: 1000, score: 5 },
      { playerId: 'b', rating: 1000, score: 2 },
    ]);
    expect(r.get('a')).toBe(1016);
    expect(r.get('b')).toBe(984);
  });

  it('a draw between equal players changes nothing', () => {
    const r = calculateElo([
      { playerId: 'a', rating: 1000, score: 3 },
      { playerId: 'b', rating: 1000, score: 3 },
    ]);
    expect(r.get('a')).toBe(1000);
    expect(r.get('b')).toBe(1000);
  });

  it('an upset gives the underdog a bigger reward', () => {
    const r = calculateElo([
      { playerId: 'under', rating: 1000, score: 10 },
      { playerId: 'fav', rating: 1400, score: 1 },
    ]);
    expect(r.get('under')! - 1000).toBeGreaterThan(16);
  });

  it('never drops below the rating floor', () => {
    const r = calculateElo([
      { playerId: 'a', rating: 100, score: 0 },
      { playerId: 'b', rating: 100, score: 9 },
    ]);
    expect(r.get('a')).toBe(100);
  });
});
