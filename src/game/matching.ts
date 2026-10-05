export interface QueueEntry {
  id: string;
  rating: number;
  waitMs: number;
}

/**
 * Pure matching algorithm (unit tested).
 * Players are sorted by rating and grouped with neighbours whose rating is close.
 * The allowed rating spread grows the longer someone waits, so nobody waits forever.
 */
export function findGroups(entries: QueueEntry[], size: number): string[][] {
  const sorted = [...entries].sort((a, b) => a.rating - b.rating);
  const groups: string[][] = [];
  let i = 0;
  while (i + size <= sorted.length) {
    const window = sorted.slice(i, i + size);
    const spread = window[window.length - 1].rating - window[0].rating;
    const longestWait = Math.max(...window.map((e) => e.waitMs));
    if (spread <= allowedSpread(longestWait)) {
      groups.push(window.map((e) => e.id));
      i += size;
    } else {
      i++;
    }
  }
  return groups;
}

export function allowedSpread(waitMs: number): number {
  // +50 rating every 5s waiting, starting at 100, capped at 1000
  return Math.min(1000, 100 + Math.floor(waitMs / 5000) * 50);
}
