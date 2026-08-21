import { z } from 'zod';

/** MSISDN in international form, no plus. MoMo sandbox is lenient; production is not. */
export const msisdn = z.string().regex(/^\d{9,15}$/, 'MSISDN must be 9-15 digits, no leading +');

export const cents = z.number().int().positive();

export const createSupplierSchema = z.object({
  name: z.string().min(2).max(120),
  msisdn,
});

export const createItemSchema = z.object({
  supplierId: z.string().uuid(),
  title: z.string().min(2).max(160),
  imageUrl: z.string().url().nullish(),
  priceCents: cents,
  mode: z.enum(['reserve', 'take_it_now']),
  minWeeklyCents: cents,
  maxWeeks: z.number().int().min(1).max(260),
});

export const createPlanSchema = z.object({
  itemId: z.string().uuid(),
  buyerMsisdn: msisdn,
  weeklyAmountCents: cents,
});

export const payAheadSchema = z.object({
  amountCents: cents.optional(),
});

export const verifyUnlockSchema = z.object({
  planId: z.string().uuid(),
  code: z.string().regex(/^\d{6,12}$/),
  lastAcceptedSequence: z.number().int().min(0).default(0),
});

export const momoCallbackSchema = z.object({
  referenceId: z.string().uuid().optional(),
  externalId: z.string().optional(),
  status: z.string(),
  financialTransactionId: z.union([z.string(), z.number()]).optional(),
  reason: z.unknown().optional(),
});
