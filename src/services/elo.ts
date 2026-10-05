/**
 * Elo rating for a free-for-all match.
 * Every player is compared pairwise with every other player (a "virtual 1v1"),
 * then the total change is averaged over the number of opponents.
 * Pure function — no I/O — so it is easy to unit test.
 */
export interface EloInput {
  playerId: string;
  rating: number;
  score: number; // in-game score; higher is better
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function calculateElo(players: EloInput[], k = 32): Map<string, number> {
  const result = new Map<string, number>();
  const opponents = players.length - 1;

  for (const a of players) {
    let delta = 0;
    for (const b of players) {
      if (a === b) continue;
      const actual = a.score > b.score ? 1 : a.score === b.score ? 0.5 : 0;
      delta += k * (actual - expectedScore(a.rating, b.rating));
    }
    const change = opponents > 0 ? Math.round(delta / opponents) : 0;
    result.set(a.playerId, Math.max(100, a.rating + change)); // rating floor 100
  }
  return result;
}
