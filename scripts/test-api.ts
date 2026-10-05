/**
 * ทดสอบ REST API ทุกตัวของ Coin Rush (ต้องเปิด server ไว้ก่อน)
 *   npm run test:api
 * บอทเล่น 1 แมตช์ก่อนก็ได้ (npm run bot) จะได้เห็นสถิติใน /stats
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const tag = Date.now().toString().slice(-5);

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const short = text.length > 110 ? text.slice(0, 110) + '…' : text;
  console.log(`${method.padEnd(6)} ${path.padEnd(22)} → ${res.status}  ${short}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const user = `tester_${tag}`;

  console.log('--- Register / Login (ได้ token + refreshToken) ---');
  const reg = await call('POST', '/auth/register', { username: user, password: 'secret123' });
  await call('POST', '/auth/login', { username: user, password: 'wrongpass' }); // 401

  console.log('--- Refresh token (rotation) ---');
  const r1 = await call('POST', '/auth/refresh', { refreshToken: reg.refreshToken });
  await call('POST', '/auth/refresh', { refreshToken: reg.refreshToken }); // ใช้ตัวเก่าซ้ำ → 401

  console.log('--- PUT /players/me ---');
  await call('PUT', '/players/me', { username: `renamed_${tag}` }, r1.token);
  await call('PUT', '/players/me', {}, r1.token); // ไม่ส่งอะไรเลย → 400
  await call('PUT', '/players/me', { password: 'newpass456' }, r1.token); // เปลี่ยนรหัส → logout ทุกเครื่อง
  await call('POST', '/auth/refresh', { refreshToken: r1.refreshToken }); // ถูกยกเลิกแล้ว → 401
  const re = await call('POST', '/auth/login', { username: `renamed_${tag}`, password: 'newpass456' });

  console.log('--- GROUP BY stats ---');
  await call('GET', '/stats/daily?days=7');
  await call('GET', '/stats/top-winners');

  console.log('--- Logout ---');
  await call('POST', '/auth/logout', { refreshToken: re.refreshToken });
  await call('POST', '/auth/refresh', { refreshToken: re.refreshToken }); // → 401

  console.log('--- DELETE /players/me ---');
  await call('DELETE', '/players/me', undefined, re.token);
  await call('GET', '/players/me', undefined, re.token); // ลบแล้ว → 404
  await call('GET', '/players/me'); // ไม่มี token → 401
}

main().catch((err) => console.error('ต่อ server ไม่ได้ — เปิด server ไว้หรือยัง?', err.message));
