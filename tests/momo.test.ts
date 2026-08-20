import { beforeEach, describe, expect, it } from 'vitest';
import { MockMomoProvider, newReferenceId } from '../src/momo/index.js';

describe('mock provider (the demo safety net)', () => {
  let momo: MockMomoProvider;

  beforeEach(() => {
    momo = new MockMomoProvider({ failingMsisdns: ['27829999999'] });
  });

  it('settles a request to pay and hands back a transaction id', async () => {
    const referenceId = newReferenceId();
    await momo.requestToPay({
      referenceId,
      amountCents: 15_000,
      payerMsisdn: '27821234567',
      externalId: 'plan-1',
      payerMessage: 'instalment',
      payeeNote: 'instalment',
    });

    const status = await momo.getRequestToPayStatus(referenceId);
    expect(status.status).toBe('SUCCESSFUL');
    expect(status.financialTransactionId).toBeTruthy();
  });

  it('fails for a configured msisdn, which is how we demo a missed payment', async () => {
    const referenceId = newReferenceId();
    await momo.requestToPay({
      referenceId,
      amountCents: 15_000,
      payerMsisdn: '27829999999',
      externalId: 'plan-1',
      payerMessage: 'instalment',
      payeeNote: 'instalment',
    });

    const status = await momo.getRequestToPayStatus(referenceId);
    expect(status.status).toBe('FAILED');
    expect(status.reason).toBe('PAYER_LIMIT_REACHED');
  });

  it('reports an unknown reference as failed rather than pending forever', async () => {
    const status = await momo.getRequestToPayStatus(newReferenceId());
    expect(status.status).toBe('FAILED');
    expect(status.reason).toBe('NOT_FOUND');
  });

  it('gives every call a distinct reference id', () => {
    const refs = new Set(Array.from({ length: 200 }, () => newReferenceId()));
    expect(refs.size).toBe(200);
  });

  it('settles a disbursement to the supplier', async () => {
    const referenceId = newReferenceId();
    await momo.transfer({
      referenceId,
      amountCents: 300_000,
      payeeMsisdn: '27827654321',
      externalId: 'plan-1',
      payerMessage: 'payout',
      payeeNote: 'payout',
    });
    expect((await momo.getTransferStatus(referenceId)).status).toBe('SUCCESSFUL');
  });
});
