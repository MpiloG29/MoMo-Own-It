import { Router } from 'express';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const healthRouter = Router();

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    let db = 'up';
    try {
      await pool.query('SELECT 1');
    } catch {
      db = 'down';
    }
    res.status(db === 'up' ? 200 : 503).json({
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      momoProvider: env.MOMO_PROVIDER,
      billingPeriodSeconds: env.BILLING_PERIOD_SECONDS,
    });
  }),
);
