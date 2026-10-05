import { Router } from 'express';
import * as statsController from '../controllers/stats.controller';

export const statsRouter = Router();

statsRouter.get('/stats/daily', statsController.daily);
statsRouter.get('/stats/top-winners', statsController.topWinners);
