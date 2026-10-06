export interface QueueEntry {
  id: string;
  rating: number;
  waitMs: number;
}

/**
 * จับคู่ผู้เล่นที่ rating ใกล้กัน
 * ยิ่งรอนาน ยิ่งยอมให้ rating ห่างได้มากขึ้น
 *
 * หมายเหตุ: เป็นอัลกอริทึมแบบ greedy (จับคู่ที่เจอก่อนทันที)
 * เลือกใช้เพราะเร็ว O(n log n) และต้องรันทุก 1 วินาที
 */
export function findGroups(entries: QueueEntry[], size: number): string[][] {
  // กันค่าผิด (edge case): กลุ่มต้องมีอย่างน้อย 2 คน
  if (!Number.isInteger(size) || size < 2) {
    throw new Error('size must be an integer of at least 2');
  }

  // ① คัดลอก array แล้วเรียงตาม rating จากน้อยไปมาก
  const sorted = [...entries].sort((a, b) => a.rating - b.rating);

  // ② เตรียมที่เก็บผลลัพธ์ และตัวชี้ตำแหน่ง
  const groups: string[][] = [];
  let i = 0;

  // ③ วนตราบที่ยังเหลือคนพอสำหรับ 1 กลุ่ม
  while (i + size <= sorted.length) {
    // ④ หยิบ size คนติดกันตั้งแต่ตำแหน่ง i
    const window = sorted.slice(i, i + size);

    // ⑤ rating คนสุดท้าย − คนแรก (เรียงแล้ว คนสุดท้ายคือมากสุด)
    const spread = window[window.length - 1].rating - window[0].rating;

    // หาเวลารอของคนที่รอนานที่สุดในกลุ่ม
    const longestWait = Math.max(...window.map((e) => e.waitMs));

    // ⑥ ห่างไม่เกินที่ยอมให้ → จับเป็นกลุ่ม
    if (spread <= allowedSpread(longestWait)) {
      groups.push(window.map((e) => e.id));
      i += size;
    } else {
      i++;
    }
  }

  // ⑦ คืนผลลัพธ์
  return groups;
}

export function allowedSpread(waitMs: number): number {
  // +50 rating ทุก 5 วินาทีที่รอ เริ่มที่ 100 สูงสุด 1000
  return Math.min(1000, 100 + Math.floor(waitMs / 5000) * 50);
}