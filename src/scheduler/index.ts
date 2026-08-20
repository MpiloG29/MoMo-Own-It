import { env } from '../config/env.js';
import { logger } from '../logger.js';
import * as collectionService from '../services/collectionService.js';
import * as disbursementService from '../services/disbursementService.js';

/**
 * A setInterval, not a cron library. One process, one loop, and a guard so a
 * slow tick never overlaps itself. That is the whole requirement here.
 */
export function startScheduler(): () => void {
  if (!env.SCHEDULER_ENABLED) {
    logger.info('scheduler.disabled');
    return () => {};
  }

  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const collected = await collectionService.runDueCollections();
      const settled = await collectionService.reconcilePending(2_000);
      const disbursed = await disbursementService.reconcilePending(2_000);
      if (collected.length || settled || disbursed) {
        logger.info('scheduler.tick', { collected: collected.length, settled, disbursed });
      }
    } catch (err) {
      logger.error('scheduler.tick.failed', { error: (err as Error).message });
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => void tick(), env.SCHEDULER_TICK_MS);
  logger.info('scheduler.started', {
    tickMs: env.SCHEDULER_TICK_MS,
    billingPeriodSeconds: env.BILLING_PERIOD_SECONDS,
  });

  return () => clearInterval(handle);
}
