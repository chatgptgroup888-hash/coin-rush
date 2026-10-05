import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { allowRequest } from '../services/rateLimit.service';
import { verifyToken, type TokenPayload } from '../services/auth.service';
import { ErrorCode, HttpError, tooManyRequests, unauthorized } from '../utils/errors';
import { logger } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/** Requires "Authorization: Bearer <jwt>" */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized('Missing bearer token');
  req.user = verifyToken(token);
  next();
}

/** Validates req.body against a zod schema and replaces it with the parsed value. */
export const validateBody =
  (schema: ZodSchema) => (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body);
    next();
  };

/** Redis-backed rate limit keyed by client IP. */
export const rateLimit =
  (bucket: string, limit: number, windowSec: number) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    const ok = await allowRequest(bucket, req.ip ?? 'unknown', limit, windowSec);
    if (!ok) throw tooManyRequests();
    next();
  };

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: ErrorCode.Validation,
        message: err.issues[0]?.message ?? 'Invalid request',
        details: err.flatten().fieldErrors,
      },
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  logger.error('Unhandled error', { path: req.path, err: (err as Error)?.message });
  return res.status(500).json({ error: { code: ErrorCode.Internal, message: 'Internal server error' } });
}
