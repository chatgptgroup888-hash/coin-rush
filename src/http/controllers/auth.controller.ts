import type { Request, Response } from 'express';
import { z } from 'zod';
import * as auth from '../../services/auth.service';

// CONTROLLER: รับ request → ตรวจ input → เรียก service → ส่ง response

export const CredentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers and underscore'),
  password: z.string().min(6).max(128),
});

export const RefreshSchema = z.object({ refreshToken: z.string().min(10) });

// POST /api/auth/register
export async function register(req: Request, res: Response) {
  const result = await auth.register(req.body.username, req.body.password);
  res.status(201).json(result);
}

// POST /api/auth/login
export async function login(req: Request, res: Response) {
  res.json(await auth.login(req.body.username, req.body.password));
}

// POST /api/auth/refresh
export async function refresh(req: Request, res: Response) {
  res.json(await auth.refresh(req.body.refreshToken));
}

// POST /api/auth/logout
export async function logout(req: Request, res: Response) {
  await auth.logout(req.body.refreshToken);
  res.status(204).send();
}
