/**
 * Load / demo script: registers N bots, puts them in the matchmaking queue
 * and makes them chase the nearest coin until the match ends.
 *
 *   npm run bot            # 2 bots against http://localhost:3000
 *   BOTS=6 npm run bot     # 6 bots -> 3 matches (with PLAYERS_PER_MATCH=2)
 */
import WebSocket from 'ws';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const BOTS = Number(process.env.BOTS ?? 2);

async function getToken(username: string): Promise<string> {
  const body = JSON.stringify({ username, password: 'bot-password' });
  const headers = { 'Content-Type': 'application/json' };
  let res = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers, body });
  if (res.status === 409) res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`${username}: auth failed ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

function runBot(name: string, token: string): Promise<void> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?token=${token}`);
    let myId = '';
    let seq = 0;

    ws.on('open', () => ws.send(JSON.stringify({ type: 'queue_join' })));

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'welcome':
          myId = msg.playerId;
          break;
        case 'queue_joined':
          console.log(`[${name}] queued (queue size ${msg.position})`);
          break;
        case 'match_found':
          console.log(`[${name}] match ${msg.matchId.slice(0, 8)} vs`, msg.players.map((p: any) => p.username));
          break;
        case 'state': {
          const me = msg.players.find((p: any) => p.id === myId);
          if (!me || msg.coins.length === 0) return;
          // chase the nearest coin (every 2nd tick to stay under the rate limit)
          if (msg.tick % 2) return;
          const coin = msg.coins.reduce((a: any, b: any) =>
            Math.hypot(a.x - me.x, a.y - me.y) < Math.hypot(b.x - me.x, b.y - me.y) ? a : b,
          );
          const dx = coin.x - me.x;
          const dy = coin.y - me.y;
          const len = Math.hypot(dx, dy) || 1;
          ws.send(JSON.stringify({ type: 'input', seq: ++seq, dx: dx / len, dy: dy / len }));
          break;
        }
        case 'match_end': {
          const mine = msg.results.find((r: any) => r.playerId === myId);
          console.log(
            `[${name}] match over — score ${mine.score}, rating ${mine.ratingBefore} → ${mine.ratingAfter}`,
            msg.winnerId === myId ? '🏆 WIN' : '',
          );
          ws.close();
          break;
        }
        case 'error':
          console.warn(`[${name}] error`, msg.code, msg.message);
      }
    });

    ws.on('close', () => resolve());
  });
}

async function main() {
  const names = Array.from({ length: BOTS }, (_, i) => `bot_${i + 1}`);
  const tokens = await Promise.all(names.map(getToken));
  await Promise.all(names.map((n, i) => runBot(n, tokens[i])));

  const board = await (await fetch(`${BASE}/api/leaderboard?limit=5`)).json();
  console.table(board);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
