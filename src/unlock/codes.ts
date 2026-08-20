import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Offline unlock codes.
 *
 * The dominant pay-as-you-go mechanism is a short numeric code typed into a
 * keypad — no signal, no data, no smartphone. The device holds a shared secret
 * and a counter; it can verify a code entirely offline.
 *
 * code = truncate( HMAC-SHA256(deviceKey, `${sequence}:${days}`) )
 *
 * The sequence prevents replay: a device only accepts a code whose sequence is
 * greater than the last one it accepted.
 */

export interface UnlockToken {
  code: string;
  sequence: number;
  days: number;
}

const PERMANENT_DAYS = 0;

export function deriveDeviceKey(masterSecret: string, planId: string): string {
  return createHmac('sha256', masterSecret).update(`device:${planId}`).digest('hex');
}

export function generateCode(args: {
  deviceKey: string;
  sequence: number;
  days: number;
  digits?: number;
}): string {
  const { deviceKey, sequence, days, digits = 9 } = args;
  if (!Number.isInteger(sequence) || sequence < 0) throw new Error('sequence must be a non-negative integer');
  if (!Number.isInteger(days) || days < 0) throw new Error('days must be a non-negative integer');

  const mac = createHmac('sha256', deviceKey).update(`${sequence}:${days}`).digest();

  // Dynamic truncation (RFC 4226 style) — stable, uniform, keypad-friendly.
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);

  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function issue(args: {
  deviceKey: string;
  sequence: number;
  days: number;
  digits?: number;
}): UnlockToken {
  return {
    code: generateCode(args),
    sequence: args.sequence,
    days: args.days,
  };
}

/** A permanent unlock is just days = 0 — the device stops asking. */
export function issuePermanent(args: { deviceKey: string; sequence: number; digits?: number }): UnlockToken {
  return issue({ ...args, days: PERMANENT_DAYS });
}

export function isPermanent(token: Pick<UnlockToken, 'days'>): boolean {
  return token.days === PERMANENT_DAYS;
}

/**
 * What the device does. Mirrored here so the firmware and the backend can be
 * tested against the same vectors.
 */
export function verifyCode(args: {
  deviceKey: string;
  code: string;
  lastAcceptedSequence: number;
  maxLookahead?: number;
  candidateDays: number[];
  digits?: number;
}): { valid: boolean; sequence?: number; days?: number } {
  const { deviceKey, code, lastAcceptedSequence, maxLookahead = 20, candidateDays, digits = 9 } = args;

  for (let seq = lastAcceptedSequence + 1; seq <= lastAcceptedSequence + maxLookahead; seq++) {
    for (const days of candidateDays) {
      const expected = generateCode({ deviceKey, sequence: seq, days, digits });
      if (expected.length !== code.length) continue;
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) {
        return { valid: true, sequence: seq, days };
      }
    }
  }
  return { valid: false };
}

export function expiresAt(from: Date, days: number): string | null {
  if (days === PERMANENT_DAYS) return null;
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

/** Reserve completion: a collection code for the counter, not a device. */
export function collectionCode(masterSecret: string, planId: string): string {
  const mac = createHmac('sha256', masterSecret).update(`collect:${planId}`).digest('hex');
  return mac.slice(0, 8).toUpperCase();
}
