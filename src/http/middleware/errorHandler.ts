import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../domain/errors.js';
import { MomoError } from '../../momo/index.js';
import { logger } from '../../logger.js';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(422).json({
      error: { code: 'VALIDATION_FAILED', message: 'Request body is invalid.', details: err.issues },
    });
    return;
  }

  // body-parser rejects a malformed body with a SyntaxError carrying the raw body.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON.' },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof MomoError) {
    logger.error('momo.error', { status: err.status, body: err.body, path: req.path });
    res.status(502).json({
      error: { code: 'MOMO_UPSTREAM', message: 'MoMo API rejected the request.' },
    });
    return;
  }

  logger.error('unhandled.error', {
    path: req.path,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
}
