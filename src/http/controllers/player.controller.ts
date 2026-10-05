import type { Request, Response } from 'express';
import { z } from 'zod';
import * as players from '../../services/player.service';
import { CredentialsSchema } from './auth.controller';

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

// PUT: ส่งมาแค่ field ที่จะเปลี่ยน แต่ต้องมีอย่างน้อย 1 field
export const UpdateAccountSchema = CredentialsSchema.partial().refine(
  (v) => v.username !== undefined || v.password !== undefined,
  { message: 'Provide username and/or password' },
);

// GET /api/players/me
export async function getMe(req: Request, res: Response) {
  res.json(await players.getProfile(req.user!.sub));
}

// PUT /api/players/me
export async function updateMe(req: Request, res: Response) {
  res.json(await players.updateAccount(req.user!.sub, req.body));
}

// DELETE /api/players/me
export async function deleteMe(req: Request, res: Response) {
  await players.deleteAccount(req.user!.sub);
  res.status(204).send();
}

// GET /api/players/me/matches
export async function getMyMatches(req: Request, res: Response) {
  const { limit } = PaginationSchema.parse(req.query);
  res.json(await players.getMatchHistory(req.user!.sub, limit));
}

// GET /api/players/:id
export async function getPlayer(req: Request, res: Response) {
  const id = z.string().uuid().parse(req.params.id);
  res.json(await players.getProfile(id));
}

// GET /api/leaderboard
export async function getLeaderboard(req: Request, res: Response) {
  const { limit, offset } = PaginationSchema.parse(req.query);
  res.json(await players.getLeaderboard(limit, offset));
}
