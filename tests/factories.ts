import type { Item } from '../src/domain/types.js';

export function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    supplierId: '22222222-2222-4222-8222-222222222222',
    title: 'Defy 254L fridge',
    imageUrl: null,
    priceCents: 300_000, // R3,000
    mode: 'reserve',
    minWeeklyCents: 10_000, // R100
    maxWeeks: 26,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export const WEEK = 604_800;
export const at = (iso: string) => new Date(iso);
