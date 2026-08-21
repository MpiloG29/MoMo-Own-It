/**
 * Money is always integer minor units (cents). Never floats.
 * Mode is a flag on one engine — see domain/plan.ts for the only two places it forks.
 */
export type Mode = 'reserve' | 'take_it_now';
export type Possession = 'on_completion' | 'immediate';
export type PlanStatus = 'active' | 'behind' | 'complete' | 'cancelled';
export type PaymentStatus = 'pending' | 'successful' | 'failed';

export interface Supplier {
  id: string;
  name: string;
  msisdn: string;
  createdAt: string;
}

export interface Item {
  id: string;
  supplierId: string;
  title: string;
  imageUrl: string | null;
  priceCents: number;
  mode: Mode;
  /** Supplier-set floor on the instalment. The supplier sets the limits, never the buyer. */
  minWeeklyCents: number;
  /** Supplier-set ceiling on plan length. */
  maxWeeks: number;
  active: boolean;
  createdAt: string;
}

export interface Plan {
  id: string;
  itemId: string;
  supplierId: string;
  buyerMsisdn: string;
  mode: Mode;
  possession: Possession;
  totalCents: number;
  weeklyAmountCents: number;
  weeks: number;
  paidCents: number;
  periodsCovered: number;
  missedCount: number;
  status: PlanStatus;
  nextDueAt: string | null;
  startedAt: string;
  completedAt: string | null;
  collectionCode: string | null;
}

export interface Payment {
  id: string;
  planId: string;
  amountCents: number;
  momoReference: string;
  status: PaymentStatus;
  financialTransactionId: string | null;
  failureReason: string | null;
  dueAt: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface UnlockCode {
  id: string;
  planId: string;
  code: string;
  sequence: number;
  daysGranted: number;
  permanent: boolean;
  issuedAt: string;
  expiresAt: string | null;
}

export interface Disbursement {
  id: string;
  planId: string;
  supplierId: string;
  amountCents: number;
  momoReference: string;
  status: PaymentStatus;
  failureReason: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface RepaymentRecord {
  buyerMsisdn: string;
  plansCompleted: number;
  plansActive: number;
  paymentsOnTime: number;
  paymentsLate: number;
  onTimeRate: number;
  totalRepaidCents: number;
  firstPlanAt: string | null;
  lastPlanAt: string | null;
}
