import type { RepaymentRecord } from '../domain/types.js';
import * as recordsRepo from '../repositories/records.js';
import * as plansRepo from '../repositories/plans.js';

/**
 * The repayment record.
 *
 * Not a requirement — nobody needs one to start their first plan.
 * Not a gate — we never approve or refuse anyone with it.
 * Not ours — it belongs to the customer, and the export is the proof.
 */
export async function forBuyer(msisdn: string): Promise<RepaymentRecord> {
  return recordsRepo.forBuyer(msisdn);
}

export interface RecordExport {
  version: '1.0';
  issuedAt: string;
  subject: { msisdn: string };
  summary: RepaymentRecord;
  plans: Array<{
    id: string;
    mode: string;
    totalCents: number;
    weeklyAmountCents: number;
    weeks: number;
    status: string;
    startedAt: string;
    completedAt: string | null;
  }>;
  disclaimer: string;
}

/**
 * A portable, self-contained document the customer can hand to a bank, a
 * landlord or a lender — on their terms, if they choose to.
 */
export async function exportFor(msisdn: string): Promise<RecordExport> {
  const [summary, plans] = await Promise.all([
    recordsRepo.forBuyer(msisdn),
    plansRepo.listByBuyer(msisdn),
  ]);

  return {
    version: '1.0',
    issuedAt: new Date().toISOString(),
    subject: { msisdn },
    summary,
    plans: plans.map((p) => ({
      id: p.id,
      mode: p.mode,
      totalCents: p.totalCents,
      weeklyAmountCents: p.weeklyAmountCents,
      weeks: p.weeks,
      status: p.status,
      startedAt: p.startedAt,
      completedAt: p.completedAt,
    })),
    disclaimer:
      'Issued by MoMo Own It at the request of the subject. This is a record of payments made, not a credit score or a recommendation.',
  };
}
