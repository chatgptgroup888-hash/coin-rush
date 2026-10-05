import { Router } from 'express';
import * as playerController from '../controllers/player.controller';
import { requireAuth, validateBody } from '../middleware';

export const playerRouter = Router();

playerRouter.get('/players/me', requireAuth, playerController.getMe);
playerRouter.put('/players/me', requireAuth, validateBody(playerController.UpdateAccountSchema), playerController.updateMe);
playerRouter.delete('/players/me', requireAuth, playerController.deleteMe);
playerRouter.get('/players/me/matches', requireAuth, playerController.getMyMatches);
playerRouter.get('/players/:id', playerController.getPlayer);
playerRouter.get('/leaderboard', playerController.getLeaderboard);
