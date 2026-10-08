import { Response } from 'express';
import { AppError } from '../errors/AppError';

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({ status: 'success', data });
}

export function sendError(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      status: 'error',
      message: error.message,
      code: error.code,
    });
    return;
  }
  console.error('[sendError]', error);
  const msg = (error as any)?.message || 'Internal server error';
  res.status(500).json({ status: 'error', message: msg, code: 'INTERNAL_ERROR' });
}
