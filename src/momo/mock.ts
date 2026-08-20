import { logger } from '../logger.js';
import type {
  MomoProvider,
  MomoStatus,
  RequestToPayInput,
  TransactionStatus,
  TransferInput,
} from './types.js';

/**
 * In-memory MoMo. Runs the entire engine with no network and no credentials.
 *
 * This exists for two reasons: tests, and the moment on stage when the
 * conference wifi dies. Flip MOMO_PROVIDER=mock and the demo still runs.
 */
export class MockMomoProvider implements MomoProvider {
  readonly name = 'mock' as const;

  private readonly transactions = new Map<string, TransactionStatus>();
  private counter = 0;

  constructor(
    private readonly opts: {
      /** ms before a PENDING transaction resolves. 0 = immediate. */
      settleAfterMs?: number;
      /** msisdns that always fail — for demoing a missed payment. */
      failingMsisdns?: string[];
    } = {},
  ) {}

  private settle(referenceId: string, msisdn: string): void {
    const fails = this.opts.failingMsisdns?.includes(msisdn) ?? false;
    const status: MomoStatus = fails ? 'FAILED' : 'SUCCESSFUL';
    const resolve = () => {
      this.transactions.set(referenceId, {
        referenceId,
        status,
        financialTransactionId: fails ? null : `MOCK-${++this.counter}`,
        reason: fails ? 'PAYER_LIMIT_REACHED' : null,
      });
    };
    if (this.opts.settleAfterMs) setTimeout(resolve, this.opts.settleAfterMs).unref?.();
    else resolve();
  }

  async requestToPay(input: RequestToPayInput): Promise<void> {
    this.transactions.set(input.referenceId, {
      referenceId: input.referenceId,
      status: 'PENDING',
      financialTransactionId: null,
      reason: null,
    });
    this.settle(input.referenceId, input.payerMsisdn);
    logger.debug('momo.mock.requestToPay', { referenceId: input.referenceId });
  }

  async getRequestToPayStatus(referenceId: string): Promise<TransactionStatus> {
    return (
      this.transactions.get(referenceId) ?? {
        referenceId,
        status: 'FAILED',
        financialTransactionId: null,
        reason: 'NOT_FOUND',
      }
    );
  }

  async transfer(input: TransferInput): Promise<void> {
    this.transactions.set(input.referenceId, {
      referenceId: input.referenceId,
      status: 'PENDING',
      financialTransactionId: null,
      reason: null,
    });
    this.settle(input.referenceId, input.payeeMsisdn);
  }

  async getTransferStatus(referenceId: string): Promise<TransactionStatus> {
    return this.getRequestToPayStatus(referenceId);
  }

  async isAccountActive(): Promise<boolean> {
    return true;
  }

  /** Test hook: force a reference into a terminal state. */
  forceStatus(referenceId: string, status: MomoStatus, reason: string | null = null): void {
    this.transactions.set(referenceId, {
      referenceId,
      status,
      financialTransactionId: status === 'SUCCESSFUL' ? `MOCK-${++this.counter}` : null,
      reason,
    });
  }
}
