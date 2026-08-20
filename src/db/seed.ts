import { logger } from '../logger.js';
import { pool } from './pool.js';
import * as itemsRepo from '../repositories/items.js';
import * as suppliersRepo from '../repositories/suppliers.js';

/**
 * Demo fixtures: one supplier per mode, one item each. We play the supplier in
 * the demo and we say so — this is that supplier.
 *
 * Replace the msisdns with your MoMo sandbox test numbers before the run.
 */
async function seed(): Promise<void> {
  const furniture = await suppliersRepo.create({
    name: 'Mahlangu Home Store',
    msisdn: process.env.SEED_RESERVE_SUPPLIER_MSISDN ?? '46733123450',
  });

  const solar = await suppliersRepo.create({
    name: 'Kgosi Solar',
    msisdn: process.env.SEED_USEIT_SUPPLIER_MSISDN ?? '46733123451',
  });

  await itemsRepo.create({
    supplierId: furniture.id,
    title: 'Defy 254L fridge',
    priceCents: 300_000,
    mode: 'reserve',
    minWeeklyCents: 10_000,
    maxWeeks: 30,
  });

  await itemsRepo.create({
    supplierId: solar.id,
    title: 'Solar home light + charger',
    priceCents: 90_000,
    mode: 'use_it',
    minWeeklyCents: 5_000,
    maxWeeks: 24,
  });

  logger.info('seed.complete', { suppliers: 2, items: 2 });
}

seed()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('seed.failed', { error: (err as Error).message });
    process.exit(1);
  });
