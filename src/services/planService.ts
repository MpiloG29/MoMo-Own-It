import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { notFound } from '../domain/errors.js';
import { planOptions, progress, quotePlan, startPlan } from '../domain/plan.js';
import type { Disbursement, Item, Payment, Plan, UnlockCode } from '../domain/types.js';
import * as disbursementsRepo from '../repositories/disbursements.js';
import * as itemsRepo from '../repositories/items.js';
import * as paymentsRepo from '../repositories/payments.js';
import * as plansRepo from '../repositories/plans.js';
import { applyEvents } from './events.js';
import { withTransaction } from '../db/pool.js';
import * as unlockService from './unlockService.js';

export async function quote(itemId: string, weeklyAmountCents: number) {
  const item = await itemsRepo.findById(itemId);
  if (!item) throw notFound('Item');
  return { item, quote: quotePlan(item, weeklyAmountCents) };
}

export async function options(itemId: string) {
  const item = await itemsRepo.findById(itemId);
  if (!item) throw notFound('Item');
  return { item, options: planOptions(item) };
}

export async function create(input: {
  itemId: string;
  buyerMsisdn: string;
  weeklyAmountCents: number;
}): Promise<Plan> {
  const item = await itemsRepo.findById(input.itemId);
  if (!item) throw notFound('Item');

  // Throws before anything is written if the plan sits outside supplier limits.
  const planQuote = quotePlan(item, input.weeklyAmountCents);
  const now = new Date();

  const { plan, events } = startPlan({
    id: randomUUID(),
    item,
    buyerMsisdn: input.buyerMsisdn,
    quote: planQuote,
    now,
    periodSeconds: env.BILLING_PERIOD_SECONDS,
  });

  return withTransaction(async (client) => {
    const saved = await plansRepo.insert(plan, client);
    await applyEvents(events, { plan: saved, now }, client);
    return saved;
  });
}

export interface PlanView {
  plan: Plan;
  item: Item | null;
  progress: ReturnType<typeof progress>;
  payments: Payment[];
  unlock: { code: UnlockCode | null; locked: boolean; permanentlyUnlocked: boolean } | null;
  disbursement: Disbursement | null;
}

export async function view(planId: string): Promise<PlanView> {
  const plan = await plansRepo.findById(planId);
  if (!plan) throw notFound('Plan');

  const [item, payments] = await Promise.all([
    itemsRepo.findById(plan.itemId),
    paymentsRepo.listByPlan(planId),
  ]);

  const unlock = plan.mode === 'take_it_now' ? await unlockService.currentFor(planId) : null;
  // Reserve pays out once, on completion — this is how the supplier (or the buyer) checks whether it landed.
  const disbursement = plan.mode === 'reserve' ? await disbursementsRepo.findByPlan(planId) : null;

  return { plan, item, progress: progress(plan), payments, unlock, disbursement };
}

export const listByBuyer = plansRepo.listByBuyer;
export const listBySupplier = plansRepo.listBySupplier;
