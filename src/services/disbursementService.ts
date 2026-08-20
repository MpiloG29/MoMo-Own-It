import { logger } from '../logger.js';
import { momo } from '../momo/index.js';
import * as disbursementsRepo from '../repositories/disbursements.js';

/**
 * Poll fallback for disbursements, mirroring collectionService.reconcilePending.
 * The transfer callback is best-effort; this is what catches the one that never lands.
 */
export async function reconcilePending(minAgeMs = 5_000): Promise<number> {
  const pending = await disbursementsRepo.listPending(minAgeMs);
  let settled = 0;

  for (const disbursement of pending) {
    try {
      const status = await momo().getTransferStatus(disbursement.momoReference);
      if (status.status === 'PENDING') continue;
      await disbursementsRepo.settle({
        momoReference: disbursement.momoReference,
        status: status.status === 'SUCCESSFUL' ? 'successful' : 'failed',
        failureReason: status.reason,
      });
      settled++;
    } catch (err) {
      logger.warn('disbursement.reconcile.failed', {
        momoReference: disbursement.momoReference,
        error: (err as Error).message,
      });
    }
  }

  return settled;
}
