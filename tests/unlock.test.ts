import { describe, expect, it } from 'vitest';
import {
  collectionCode,
  deriveDeviceKey,
  expiresAt,
  generateCode,
  isPermanent,
  issue,
  issuePermanent,
  verifyCode,
} from '../src/unlock/codes.js';

const MASTER = 'test-secret-test-secret-0123';
const PLAN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const keyA = deriveDeviceKey(MASTER, PLAN_A);
const keyB = deriveDeviceKey(MASTER, PLAN_B);
const CANDIDATES = [0, 7, 14, 21, 28];

describe('code generation', () => {
  it('is deterministic and keypad-shaped', () => {
    const a = generateCode({ deviceKey: keyA, sequence: 1, days: 7 });
    const b = generateCode({ deviceKey: keyA, sequence: 1, days: 7 });
    expect(a).toBe(b);
    expect(a).toMatch(/^\d{9}$/);
  });

  it('gives a different code per sequence, per duration and per device', () => {
    const base = generateCode({ deviceKey: keyA, sequence: 1, days: 7 });
    expect(generateCode({ deviceKey: keyA, sequence: 2, days: 7 })).not.toBe(base);
    expect(generateCode({ deviceKey: keyA, sequence: 1, days: 14 })).not.toBe(base);
    expect(generateCode({ deviceKey: keyB, sequence: 1, days: 7 })).not.toBe(base);
  });

  it('honours the configured digit length', () => {
    expect(generateCode({ deviceKey: keyA, sequence: 1, days: 7, digits: 6 })).toMatch(/^\d{6}$/);
  });
});

describe('offline verification (what the lamp does)', () => {
  it('accepts a fresh code and reports the days it grants', () => {
    const token = issue({ deviceKey: keyA, sequence: 1, days: 7 });
    const result = verifyCode({
      deviceKey: keyA,
      code: token.code,
      lastAcceptedSequence: 0,
      candidateDays: CANDIDATES,
    });
    expect(result).toEqual({ valid: true, sequence: 1, days: 7 });
  });

  it('rejects replay of a code the device already consumed', () => {
    const token = issue({ deviceKey: keyA, sequence: 3, days: 7 });
    expect(
      verifyCode({ deviceKey: keyA, code: token.code, lastAcceptedSequence: 3, candidateDays: CANDIDATES })
        .valid,
    ).toBe(false);
  });

  it('catches up when the customer skips codes (paid by other means, gaps in delivery)', () => {
    const token = issue({ deviceKey: keyA, sequence: 6, days: 14 });
    const result = verifyCode({
      deviceKey: keyA,
      code: token.code,
      lastAcceptedSequence: 1,
      candidateDays: CANDIDATES,
    });
    expect(result.valid).toBe(true);
    expect(result.sequence).toBe(6);
  });

  it('rejects a code minted for another device', () => {
    const token = issue({ deviceKey: keyB, sequence: 1, days: 7 });
    expect(
      verifyCode({ deviceKey: keyA, code: token.code, lastAcceptedSequence: 0, candidateDays: CANDIDATES })
        .valid,
    ).toBe(false);
  });

  it('rejects a guessed code', () => {
    expect(
      verifyCode({
        deviceKey: keyA,
        code: '000000000',
        lastAcceptedSequence: 0,
        candidateDays: CANDIDATES,
      }).valid,
    ).toBe(false);
  });
});

describe('permanent unlock on completion', () => {
  it('is days = 0 and never expires', () => {
    const token = issuePermanent({ deviceKey: keyA, sequence: 20 });
    expect(isPermanent(token)).toBe(true);
    expect(expiresAt(new Date(), token.days)).toBeNull();

    const result = verifyCode({
      deviceKey: keyA,
      code: token.code,
      lastAcceptedSequence: 19,
      candidateDays: CANDIDATES,
    });
    expect(result).toEqual({ valid: true, sequence: 20, days: 0 });
  });
});

describe('expiry window', () => {
  it('grants exactly the days paid for', () => {
    const from = new Date('2026-03-01T00:00:00.000Z');
    expect(expiresAt(from, 7)).toBe('2026-03-08T00:00:00.000Z');
  });
});

describe('reserve collection code', () => {
  it('is short, stable and unique per plan', () => {
    const a = collectionCode(MASTER, PLAN_A);
    expect(a).toMatch(/^[0-9A-F]{8}$/);
    expect(collectionCode(MASTER, PLAN_A)).toBe(a);
    expect(collectionCode(MASTER, PLAN_B)).not.toBe(a);
  });
});
