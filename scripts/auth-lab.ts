/**
 * K4 Lab: ทดลอง bcrypt + JWT ด้วยตัวเอง (ไม่ต้องเปิด database)
 *   npx tsx scripts/auth-lab.ts
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const SECRET = 'my-lab-secret';

async function main() {
  // ---------- 1) bcrypt: เก็บรหัสผ่านแบบ hash ----------
  const password = 'secret123';
  const hash = await bcrypt.hash(password, 10);
  console.log('1) hash ของรหัสผ่าน:', hash);
  console.log('   hash ซ้ำอีกรอบ ได้ไม่เหมือนเดิม:', await bcrypt.hash(password, 10));
  console.log('   รหัสถูก →', await bcrypt.compare('secret123', hash));
  console.log('   รหัสผิด →', await bcrypt.compare('wrongpass', hash));

  // ---------- 2) JWT: สร้าง token ----------
  const token = jwt.sign({ sub: 'player-42', username: 'shin' }, SECRET, { expiresIn: '15m' });
  console.log('\n2) JWT token:', token);

  // JWT มี 3 ส่วนคั่นด้วยจุด: header.payload.signature
  const [header, payload] = token.split('.');
  console.log('   header :', Buffer.from(header, 'base64url').toString());
  console.log('   payload:', Buffer.from(payload, 'base64url').toString());
  console.log('   ⚠️ payload ใครก็อ่านได้ ห้ามใส่รหัสผ่านหรือข้อมูลลับใน token');

  // ---------- 3) ตรวจ token ----------
  const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload;
  console.log('\n3) verify ผ่าน → ผู้เล่น:', decoded.sub, decoded.username);

  // ---------- 4) ปลอม token (แก้ payload) ----------
  const fakePayload = Buffer.from(JSON.stringify({ sub: 'admin', username: 'hacker' })).toString('base64url');
  const forged = [header, fakePayload, token.split('.')[2]].join('.');
  try {
    jwt.verify(forged, SECRET);
  } catch (err) {
    console.log('\n4) token ปลอม → ถูกปฏิเสธ:', (err as Error).message);
  }

  // ---------- 5) secret ผิด ----------
  try {
    jwt.verify(token, 'wrong-secret');
  } catch (err) {
    console.log('5) secret ผิด → ถูกปฏิเสธ:', (err as Error).message);
  }

  // ---------- 6) token หมดอายุ ----------
  const shortToken = jwt.sign({ sub: 'player-42' }, SECRET, { expiresIn: '1s' });
  await new Promise((r) => setTimeout(r, 1500));
  try {
    jwt.verify(shortToken, SECRET);
  } catch (err) {
    console.log('6) รอเกิน 1 วินาที → หมดอายุ:', (err as Error).message);
  }
}

main();