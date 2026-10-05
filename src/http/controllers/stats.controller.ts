import type { Request, Response } from 'express';
import { z } from 'zod';
import * as stats from '../../services/stats.service';

const DaysSchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

// GET /api/stats/daily?days=7
export async function daily(req: Request, res: Response) {
  const { days } = DaysSchema.parse(req.query);
  res.json(await stats.getDailyStats(days));
}

// GET /api/stats/top-winners
export async function topWinners(_req: Request, res: Response) {
  res.json(await stats.getTopWinners(10));
}
