import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { redis, keys } from '../db/redis';
import { Matchmaker } from '../game/Matchmaker';
import { RoomManager } from '../game/RoomManager';
import { ClientMessageSchema, type Send, type ServerMessage } from '../game/types';
import { verifyToken } from '../services/auth.service';
import { getRating } from '../services/player.service';
import { logger } from '../utils/logger';

interface ClientSocket extends WebSocket {
  playerId: string;
  username: string;
  isAlive: boolean;
  // token bucket for per-connection message rate limiting
  tokens: number;
  lastRefill: number;
}

const HEARTBEAT_MS = 15_000;
const PRESENCE_TTL_SEC = 30;
const MAX_MSG_PER_SEC = 60;
const MAX_PAYLOAD_BYTES = 1024;

export function createGameSocketServer(server: Server, playersPerMatch: number) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const sockets = new Map<string, ClientSocket>(); // playerId -> socket (one per player)

  const senderFor = (ws: ClientSocket): Send => (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const rooms = new RoomManager((playerId) => {
    const ws = sockets.get(playerId);
    return ws ? senderFor(ws) : null;
  });

  const matchmaker = new Matchmaker(playersPerMatch, async (ids) => {
    await rooms.createRoom(ids);
  });

  /* ---------- Upgrade: authenticate BEFORE accepting the socket ---------- */
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    try {
      const token = url.searchParams.get('token') ?? '';
      const user = verifyToken(token);
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client = ws as ClientSocket;
        client.playerId = user.sub;
        client.username = user.username;
        wss.emit('connection', client, req);
      });
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  /* ---------- Connection ---------- */
  wss.on('connection', (ws: ClientSocket) => {
    const { playerId, username } = ws;

    // Only one live connection per player: kick the older one
    const existing = sockets.get(playerId);
    if (existing && existing !== ws) existing.close(4000, 'Connected from another location');

    sockets.set(playerId, ws);
    ws.isAlive = true;
    ws.tokens = MAX_MSG_PER_SEC;
    ws.lastRefill = Date.now();
    void redis.set(keys.online(playerId), '1', 'EX', PRESENCE_TTL_SEC);

    const send = senderFor(ws);
    send({ type: 'welcome', playerId, username });
    rooms.onPlayerConnected(playerId, send); // resume an in-progress match, if any
    logger.info('WS connected', { playerId, username });

    ws.on('pong', () => {
      ws.isAlive = true;
      void redis.expire(keys.online(playerId), PRESENCE_TTL_SEC);
    });

    ws.on('message', (data) => {
      if (!consumeToken(ws)) {
        send({ type: 'error', code: 'RATE_LIMITED', message: 'Too many messages' });
        return;
      }
      handleMessage(ws, send, data.toString()).catch((err) => {
        logger.error('WS handler error', { playerId, err: err.message });
        send({ type: 'error', code: 'INTERNAL', message: 'Internal error' });
      });
    });

    ws.on('close', () => {
      // Ignore close of a socket that was already replaced by a newer one
      if (sockets.get(playerId) !== ws) return;
      sockets.delete(playerId);
      void redis.del(keys.online(playerId));
      void matchmaker.leave(playerId);
      rooms.onPlayerDisconnected(playerId);
      logger.info('WS disconnected', { playerId });
    });
  });

  /* ---------- Message router ---------- */
  async function handleMessage(ws: ClientSocket, send: Send, raw: string) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return send({ type: 'error', code: 'BAD_JSON', message: 'Message must be JSON' });
    }
    const parsed = ClientMessageSchema.safeParse(json);
    if (!parsed.success) {
      return send({ type: 'error', code: 'BAD_MESSAGE', message: parsed.error.issues[0].message });
    }
    const msg = parsed.data;

    switch (msg.type) {
      case 'ping':
        return send({ type: 'pong', t: msg.t, serverTime: Date.now() });

      case 'queue_join': {
        if (rooms.getRoomOf(ws.playerId)) {
          return send({ type: 'error', code: 'IN_MATCH', message: 'Already in a match' });
        }
        const rating = await getRating(ws.playerId);
        const position = await matchmaker.join(ws.playerId, rating);
        return send({ type: 'queue_joined', position });
      }

      case 'queue_leave':
        await matchmaker.leave(ws.playerId);
        return send({ type: 'queue_left' });

      case 'input': {
        const room = rooms.getRoomOf(ws.playerId);
        if (!room) return send({ type: 'error', code: 'NOT_IN_MATCH', message: 'Not in a match' });
        return room.handleInput(ws.playerId, msg.seq, msg.dx, msg.dy);
      }
    }
  }

  /* ---------- Heartbeat: drop dead connections ---------- */
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<ClientSocket>) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  return {
    wss,
    rooms,
    matchmaker,
    get onlineCount() {
      return sockets.size;
    },
    async close() {
      clearInterval(heartbeat);
      matchmaker.stop();
      await rooms.shutdown();
      for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
      wss.close();
    },
  };
}

function consumeToken(ws: ClientSocket): boolean {
  const now = Date.now();
  ws.tokens = Math.min(MAX_MSG_PER_SEC, ws.tokens + ((now - ws.lastRefill) / 1000) * MAX_MSG_PER_SEC);
  ws.lastRefill = now;
  if (ws.tokens < 1) return false;
  ws.tokens -= 1;
  return true;
}
