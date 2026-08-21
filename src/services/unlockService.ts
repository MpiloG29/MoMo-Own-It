import { env } from '../config/env.js';
import { notFound } from '../domain/errors.js';
import type { UnlockCode } from '../domain/types.js';
import * as unlockCodes from '../repositories/unlockCodes.js';
import * as plans from '../repositories/plans.js';
import type { Queryable } from '../db/pool.js';
import { pool } from '../db/pool.js';
import { deriveDeviceKey, expiresAt, generateCode, verifyCode } from '../unlock/codes.js';

export function deviceKeyFor(planId: string): string {
  return deriveDeviceKey(env.UNLOCK_HMAC_SECRET, planId);
}

export async function issueForPlan(
  args: { planId: string; days: number; permanent?: boolean; now: Date },
  db: Queryable = pool,
): Promise<UnlockCode> {
  const sequence = await unlockCodes.nextSequence(args.planId, db);
  const days = args.permanent ? 0 : args.days;
  const code = generateCode({
    deviceKey: deviceKeyFor(args.planId),
    sequence,
    days,
    digits: env.UNLOCK_CODE_DIGITS,
  });

  return unlockCodes.insert(
    {
      planId: args.planId,
      code,
      sequence,
      daysGranted: days,
      permanent: Boolean(args.permanent),
      expiresAt: args.permanent ? null : expiresAt(args.now, days),
    },
    db,
  );
}

export async function currentFor(planId: string): Promise<{
  code: UnlockCode | null;
  locked: boolean;
  permanentlyUnlocked: boolean;
}> {
  const plan = await plans.findById(planId);
  if (!plan) throw notFound('Plan');

  const code = await unlockCodes.latest(planId);
  const permanentlyUnlocked = Boolean(code?.permanent);
  const locked =
    plan.mode === 'take_it_now' &&
    !permanentlyUnlocked &&
    (!code || (code.expiresAt !== null && Date.parse(code.expiresAt) <= Date.now()));

  return { code, locked, permanentlyUnlocked };
}

export async function listFor(planId: string): Promise<UnlockCode[]> {
  return unlockCodes.listByPlan(planId);
}

/**
 * The device-side check, exposed over HTTP so the ESP32 (or its simulator) can
 * be validated against the same vectors the backend generates.
 */
export function verifyForDevice(args: {
  planId: string;
  code: string;
  lastAcceptedSequence: number;
}): { valid: boolean; sequence?: number; days?: number } {
  const candidateDays = [0];
  for (let periods = 1; periods <= 12; periods++) {
    candidateDays.push(periods * env.UNLOCK_DAYS_PER_PERIOD);
  }
  return verifyCode({
    deviceKey: deviceKeyFor(args.planId),
    code: args.code,
    lastAcceptedSequence: args.lastAcceptedSequence,
    candidateDays,
    digits: env.UNLOCK_CODE_DIGITS,
  });
}
