import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { itemsRouter } from './routes/items.js';
import { plansRouter } from './routes/plans.js';
import { recordsRouter } from './routes/records.js';
import { suppliersRouter } from './routes/suppliers.js';
import { webhooksRouter } from './routes/webhooks.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.use(healthRouter);
  app.use('/api/v1', suppliersRouter);
  app.use('/api/v1', itemsRouter);
  app.use('/api/v1', plansRouter);
  app.use('/api/v1', recordsRouter);
  app.use(webhooksRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such route.' } });
  });

  app.use(errorHandler);

  return app;
}
