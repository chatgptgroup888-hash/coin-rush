import { describe, expect, it } from 'vitest';
import { allowedSpread, findGroups } from './matching';

describe('findGroups', () => {
  it('pairs players with similar rating', () => {
    const groups = findGroups(
      [
        { id: 'a', rating: 1000, waitMs: 0 },
        { id: 'b', rating: 1500, waitMs: 0 },
        { id: 'c', rating: 1050, waitMs: 0 },
        { id: 'd', rating: 1520, waitMs: 0 },
      ],
      2,
    );
    expect(groups).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
  });

  it('does not match players who are too far apart at first', () => {
    const groups = findGroups(
      [
        { id: 'a', rating: 1000, waitMs: 0 },
        { id: 'b', rating: 1400, waitMs: 0 },
      ],
      2,
    );
    expect(groups).toEqual([]);
  });

  it('widens the window the longer someone waits', () => {
    const groups = findGroups(
      [
        { id: 'a', rating: 1000, waitMs: 40_000 },
        { id: 'b', rating: 1400, waitMs: 0 },
      ],
      2,
    );
    expect(groups).toEqual([['a', 'b']]);
  });

  it('supports groups larger than 2', () => {
    const entries = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, rating: 1000 + i * 10, waitMs: 0 }));
    expect(findGroups(entries, 4)).toEqual([['a', 'b', 'c', 'd']]);
  });
});

describe('allowedSpread', () => {
  it('starts at 100 and is capped at 1000', () => {
    expect(allowedSpread(0)).toBe(100);
    expect(allowedSpread(10 * 60_000)).toBe(1000);
  });
});
