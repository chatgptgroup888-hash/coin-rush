import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { rateLimit, validateBody } from '../middleware';

// ROUTES: บอกแค่ว่า URL ไหน → middleware อะไร → controller ตัวไหน
export const authRouter = Router();

// register/login: 10 ครั้ง/นาที/IP — กันการเดารหัสผ่าน (brute force)
const strictLimit = rateLimit('auth', 10, 60);
// refresh/logout: เรียกบ่อยได้กว่า แต่ยังกันสแปม
const tokenLimit = rateLimit('auth-token', 30, 60);

authRouter.post('/register', strictLimit, validateBody(authController.CredentialsSchema), authController.register);
authRouter.post('/login', strictLimit, validateBody(authController.CredentialsSchema), authController.login);
authRouter.post('/refresh', tokenLimit, validateBody(authController.RefreshSchema), authController.refresh);
authRouter.post('/logout', tokenLimit, validateBody(authController.RefreshSchema), authController.logout);
