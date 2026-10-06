export interface EloInput {
  playerId: string;
  rating: number;
  score: number; // คะแนนในเกม ยิ่งมากยิ่งดี
}

// โอกาสชนะที่คาดไว้ของ A เมื่อเจอ B (ได้ค่า 0 ถึง 1)
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function calculateElo(players: EloInput[], k = 32): Map<string, number> {
  const result = new Map<string, number>();
  const opponents = players.length - 1;

  for (const a of players) {
    let delta = 0;

    // เทียบ a กับผู้เล่นทุกคน (ยกเว้นตัวเอง)
    for (const b of players) {
      if (a === b) continue;

      // ผลจริง: ชนะ = 1, เสมอ = 0.5, แพ้ = 0
      const actual = a.score > b.score ? 1 : a.score === b.score ? 0.5 : 0;

      // แต้มที่เปลี่ยน = k × (ผลจริง − ที่คาดไว้)
      delta += k * (actual - expectedScore(a.rating, b.rating));
    }

    // เฉลี่ยตามจำนวนคู่แข่ง แล้วปัดเป็นจำนวนเต็ม
    const change = opponents > 0 ? Math.round(delta / opponents) : 0;

    // rating ต่ำสุดไม่ต่ำกว่า 100
    result.set(a.playerId, Math.max(100, a.rating + change));
  }
  return result;
}