import { Router } from 'express';
import { logger } from '../../logger.js';
import * as collectionService from '../../services/collectionService.js';
import * as disbursementsRepo from '../../repositories/disbursements.js';
import { optionalParam } from '../params.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { momoCallbackSchema } from '../validation.js';

export const webhooksRouter = Router();

/**
 * MoMo posts here when a requestToPay resolves. The reference can arrive in the
 * body or on the path depending on how the callback host is registered, so we
 * accept both. The poller in collectionService is the safety net either way —
 * a callback that never lands costs us seconds, not correctness.
 */
webhooksRouter.post(
  '/webhooks/momo/collection/:referenceId?',
  asyncHandler(async (req, res) => {
    const body = momoCallbackSchema.parse(req.body ?? {});
    const referenceId = optionalParam(req, 'referenceId') ?? body.referenceId;

    if (!referenceId) {
      res.status(400).json({ error: { code: 'NO_REFERENCE', message: 'Missing reference id.' } });
      return;
    }

    // Acknowledge fast; MoMo retries anything it thinks we did not receive.
    res.status(200).json({ received: true });

    try {
      await collectionService.settlePayment(referenceId, {
        status: body.status === 'SUCCESSFUL' ? 'successful' : 'failed',
        financialTransactionId: body.financialTransactionId
          ? String(body.financialTransactionId)
          : null,
        reason: body.reason ? JSON.stringify(body.reason) : null,
      });
    } catch (err) {
      logger.error('webhook.collection.failed', {
        referenceId,
        error: (err as Error).message,
      });
    }
  }),
);

webhooksRouter.post(
  '/webhooks/momo/disbursement/:referenceId?',
  asyncHandler(async (req, res) => {
    const body = momoCallbackSchema.parse(req.body ?? {});
    const referenceId = optionalParam(req, 'referenceId') ?? body.referenceId;

    if (!referenceId) {
      res.status(400).json({ error: { code: 'NO_REFERENCE', message: 'Missing reference id.' } });
      return;
    }

    res.status(200).json({ received: true });

    await disbursementsRepo.settle({
      momoReference: referenceId,
      status: body.status === 'SUCCESSFUL' ? 'successful' : 'failed',
      failureReason: body.reason ? JSON.stringify(body.reason) : null,
    });
  }),
);
