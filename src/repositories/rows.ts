import type { Disbursement, Item, Payment, Plan, Supplier, UnlockCode } from '../domain/types.js';

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : v;

export const toSupplier = (r: Record<string, any>): Supplier => ({
  id: r.id,
  name: r.name,
  msisdn: r.msisdn,
  createdAt: iso(r.created_at)!,
});

export const toItem = (r: Record<string, any>): Item => ({
  id: r.id,
  supplierId: r.supplier_id,
  title: r.title,
  imageUrl: r.image_url,
  priceCents: Number(r.price_cents),
  mode: r.mode,
  minWeeklyCents: Number(r.min_weekly_cents),
  maxWeeks: Number(r.max_weeks),
  active: r.active,
  createdAt: iso(r.created_at)!,
});

export const toPlan = (r: Record<string, any>): Plan => ({
  id: r.id,
  itemId: r.item_id,
  supplierId: r.supplier_id,
  buyerMsisdn: r.buyer_msisdn,
  mode: r.mode,
  possession: r.possession,
  totalCents: Number(r.total_cents),
  weeklyAmountCents: Number(r.weekly_amount_cents),
  weeks: Number(r.weeks),
  paidCents: Number(r.paid_cents),
  periodsCovered: Number(r.periods_covered),
  missedCount: Number(r.missed_count),
  status: r.status,
  nextDueAt: iso(r.next_due_at),
  startedAt: iso(r.started_at)!,
  completedAt: iso(r.completed_at),
  collectionCode: r.collection_code,
});

export const toPayment = (r: Record<string, any>): Payment => ({
  id: r.id,
  planId: r.plan_id,
  amountCents: Number(r.amount_cents),
  momoReference: r.momo_reference,
  status: r.status,
  financialTransactionId: r.financial_transaction_id,
  failureReason: r.failure_reason,
  dueAt: iso(r.due_at),
  createdAt: iso(r.created_at)!,
  settledAt: iso(r.settled_at),
});

export const toUnlockCode = (r: Record<string, any>): UnlockCode => ({
  id: r.id,
  planId: r.plan_id,
  code: r.code,
  sequence: Number(r.sequence),
  daysGranted: Number(r.days_granted),
  permanent: r.permanent,
  issuedAt: iso(r.issued_at)!,
  expiresAt: iso(r.expires_at),
});

export const toDisbursement = (r: Record<string, any>): Disbursement => ({
  id: r.id,
  planId: r.plan_id,
  supplierId: r.supplier_id,
  amountCents: Number(r.amount_cents),
  momoReference: r.momo_reference,
  status: r.status,
  failureReason: r.failure_reason,
  createdAt: iso(r.created_at)!,
  settledAt: iso(r.settled_at),
});
