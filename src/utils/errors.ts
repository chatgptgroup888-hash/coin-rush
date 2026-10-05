// enum = ชุดค่าคงที่ที่มีชื่อ ใช้เป็นรหัส error ที่ client อ่านได้ (พิมพ์ผิดจะ compile ไม่ผ่าน)
export enum ErrorCode {
  BadRequest = 'BAD_REQUEST',
  Validation = 'VALIDATION_ERROR',
  Unauthorized = 'UNAUTHORIZED',
  NotFound = 'NOT_FOUND',
  Conflict = 'CONFLICT',
  RateLimited = 'RATE_LIMITED',
  Internal = 'INTERNAL',
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: ErrorCode = ErrorCode.Internal,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg, ErrorCode.BadRequest);
export const unauthorized = (msg = 'Unauthorized') => new HttpError(401, msg, ErrorCode.Unauthorized);
export const notFound = (msg = 'Not found') => new HttpError(404, msg, ErrorCode.NotFound);
export const conflict = (msg: string) => new HttpError(409, msg, ErrorCode.Conflict);
export const tooManyRequests = (msg = 'Too many requests') =>
  new HttpError(429, msg, ErrorCode.RateLimited);
