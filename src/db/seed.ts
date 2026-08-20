import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../config/env.js';
import {
  applyPayment,
  nextInstalmentCents,
  onMissedPayment,
  quotePlan,
  startPlan,
} from '../domain/plan.js';
import type { Item, Mode, Plan, Supplier } from '../domain/types.js';
import { logger } from '../logger.js';
import * as disbursementsRepo from '../repositories/disbursements.js';
import * as plansRepo from '../repositories/plans.js';
import * as unlockCodesRepo from '../repositories/unlockCodes.js';
import { toItem, toSupplier } from '../repositories/rows.js';
import { applyEvents } from '../services/events.js';
import { pool, withTransaction, type Queryable } from './pool.js';

/**
 * Demo fixtures.
 *
 * Every plan below is built by running the real engine — quotePlan, startPlan,
 * applyPayment, onMissedPayment, applyEvents — over a backdated clock. Nothing
 * here hand-writes a derived value, so the unlock codes, collection codes,
 * ledgers, progress and payout rows are exactly what the API would have
 * produced had the demo run for real. Change the engine and the fixtures follow.
 *
 * The one thing the seed does write directly is timestamps: the repositories
 * take `now()` from the database (correctly — production must never let a caller
 * choose when a payment settled), so payment rows are inserted here with
 * explicit created_at/settled_at to give each plan a history.
 *
 * Timing follows BILLING_PERIOD_SECONDS, so on the demo clock (20s) a six-week
 * history spans two minutes and every plan's next instalment falls due about
 * now — which is what makes `POST /api/v1/demo/tick` do something immediately.
 */

// ---------------------------------------------------------------------------
// Seeded rows carry recognisable ids: 5eed…0001 is supplier one, and so on.
// Stable ids mean saved requests and Postman collections survive a re-seed.
// ---------------------------------------------------------------------------
const ID_GROUP = {
  supplier: '5eed0001',
  item: '5eed0002',
  plan: '5eed0003',
  payment: '5eed0004',
} as const;

function seedId(kind: keyof typeof ID_GROUP, n: number): string {
  return `${ID_GROUP[kind]}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const money = (cents: number): string => (cents / 100).toFixed(2);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
interface SupplierFixture {
  ref: number;
  name: string;
  msisdn: string;
}

interface ItemFixture {
  ref: number;
  supplierRef: number;
  title: string;
  imageUrl: string;
  priceCents: number;
  mode: Mode;
  minWeeklyCents: number;
  maxWeeks: number;
  active?: boolean;
}

/** One period of a plan's history. `in_flight` must be the last step of a plan. */
type Step = 'paid' | 'late' | 'missed' | 'in_flight';

interface PlanFixture {
  ref: number;
  itemRef: number;
  buyerMsisdn: string;
  weeklyAmountCents: number;
  history: Step[];
  /** Reserve completion: has the payout callback landed, or is it still in flight? */
  payout?: 'settled' | 'pending';
  /** Use It: age the live code out so the API reports a dark device. */
  deviceDark?: boolean;
  note: string;
}

const SUPPLIERS: SupplierFixture[] = [
  // Override with MoMo sandbox test numbers before a live run.
  { ref: 1, name: 'Mahlangu Home Store', msisdn: process.env.SEED_RESERVE_SUPPLIER_MSISDN ?? '46733123450' },
  { ref: 2, name: 'Kgosi Solar', msisdn: process.env.SEED_USEIT_SUPPLIER_MSISDN ?? '46733123451' },
  { ref: 3, name: 'Tshwane Mobile & Tech', msisdn: process.env.SEED_MIXED_SUPPLIER_MSISDN ?? '46733123452' },
];

const ITEMS: ItemFixture[] = [
  {
    ref: 1,
    supplierRef: 1,
    title: 'Defy 254L fridge',
    imageUrl: 'https://picsum.photos/seed/momo-fridge/640/480',
    priceCents: 300_000,
    mode: 'reserve',
    minWeeklyCents: 10_000,
    maxWeeks: 30,
  },
  {
    ref: 2,
    supplierRef: 1,
    title: 'Double bed set',
    imageUrl: 'https://picsum.photos/seed/momo-bed/640/480',
    priceCents: 450_000,
    mode: 'reserve',
    minWeeklyCents: 15_000,
    maxWeeks: 40,
  },
  {
    ref: 3,
    supplierRef: 1,
    title: '4-plate gas stove',
    imageUrl: 'https://picsum.photos/seed/momo-stove/640/480',
    priceCents: 120_000,
    mode: 'reserve',
    minWeeklyCents: 6_000,
    maxWeeks: 24,
  },
  {
    ref: 4,
    supplierRef: 2,
    title: 'Solar home light + phone charger',
    imageUrl: 'https://picsum.photos/seed/momo-solar-light/640/480',
    priceCents: 90_000,
    mode: 'use_it',
    minWeeklyCents: 5_000,
    maxWeeks: 24,
  },
  {
    ref: 5,
    supplierRef: 2,
    title: 'Solar TV bundle',
    imageUrl: 'https://picsum.photos/seed/momo-solar-tv/640/480',
    priceCents: 240_000,
    mode: 'use_it',
    minWeeklyCents: 10_000,
    maxWeeks: 30,
  },
  {
    ref: 6,
    supplierRef: 2,
    title: 'Solar water pump',
    imageUrl: 'https://picsum.photos/seed/momo-pump/640/480',
    priceCents: 320_000,
    mode: 'use_it',
    minWeeklyCents: 16_000,
    maxWeeks: 26,
  },
  {
    ref: 7,
    supplierRef: 3,
    title: 'Entry Android smartphone',
    imageUrl: 'https://picsum.photos/seed/momo-phone/640/480',
    priceCents: 200_000,
    mode: 'use_it',
    minWeeklyCents: 8_000,
    maxWeeks: 30,
  },
  {
    ref: 8,
    supplierRef: 3,
    title: 'Sewing machine',
    imageUrl: 'https://picsum.photos/seed/momo-sewing/640/480',
    priceCents: 180_000,
    mode: 'reserve',
    minWeeklyCents: 9_000,
    maxWeeks: 26,
  },
  {
    // De-listed: absent from GET /items, and quoting it fails with ITEM_INACTIVE.
    ref: 9,
    supplierRef: 1,
    title: 'Chest freezer (sold out)',
    imageUrl: 'https://picsum.photos/seed/momo-freezer/640/480',
    priceCents: 260_000,
    mode: 'reserve',
    minWeeklyCents: 13_000,
    maxWeeks: 26,
    active: false,
  },
];

const BUYERS = {
  thabo: process.env.SEED_BUYER_MSISDN ?? '46733123453',
  nomsa: '46733123454',
  sipho: '46733123455',
  lerato: '46733123456',
} as const;

const PLANS: PlanFixture[] = [
  {
    ref: 1,
    itemRef: 1,
    buyerMsisdn: BUYERS.thabo,
    weeklyAmountCents: 15_000,
    history: ['paid'],
    note: 'Reserve, just started: one instalment in, 19 to go.',
  },
  {
    ref: 2,
    itemRef: 2,
    buyerMsisdn: BUYERS.thabo,
    weeklyAmountCents: 30_000,
    history: ['paid', 'paid', 'late', 'paid', 'paid', 'paid'],
    note: 'Reserve, mid-plan with one late payment — the record shows paymentsLate: 1.',
  },
  {
    ref: 3,
    itemRef: 3,
    buyerMsisdn: BUYERS.sipho,
    weeklyAmountCents: 30_000,
    history: ['paid', 'paid', 'paid', 'paid'],
    payout: 'settled',
    note: 'Reserve, complete and paid out: collection code issued, disbursement successful.',
  },
  {
    ref: 4,
    itemRef: 8,
    buyerMsisdn: BUYERS.sipho,
    weeklyAmountCents: 60_000,
    history: ['paid', 'paid', 'paid'],
    payout: 'pending',
    note: 'Reserve, complete but the payout callback never landed — what the disbursement reconciler picks up.',
  },
  {
    ref: 5,
    itemRef: 4,
    buyerMsisdn: BUYERS.thabo,
    weeklyAmountCents: 10_000,
    history: ['paid', 'paid', 'paid'],
    note: 'Use It, running: device unlocked, live code on the plan.',
  },
  {
    ref: 6,
    itemRef: 5,
    buyerMsisdn: BUYERS.nomsa,
    weeklyAmountCents: 25_000,
    history: ['paid', 'paid', 'missed'],
    deviceDark: true,
    note: 'Use It, behind: the missed week ran the code out and the device is locked. Rounds to 10 weeks with a smaller final instalment.',
  },
  {
    ref: 7,
    itemRef: 7,
    buyerMsisdn: BUYERS.sipho,
    weeklyAmountCents: 50_000,
    history: ['paid', 'paid', 'paid', 'paid'],
    note: 'Use It, paid off: permanent unlock, no more codes ever.',
  },
  {
    ref: 8,
    itemRef: 6,
    buyerMsisdn: BUYERS.lerato,
    weeklyAmountCents: 20_000,
    history: ['paid', 'paid', 'in_flight'],
    note: 'Use It with a collection awaiting confirmation — settle it by POSTing the webhook below.',
  },
];

// ---------------------------------------------------------------------------
// Reset
//
// This database may not be exclusively ours, so every table is checked for a
// column only the MoMo Own It schema has before a single row is deleted.
// ---------------------------------------------------------------------------
const OWNED_TABLES = [
  { table: 'payments', signature: 'momo_reference' },
  { table: 'unlock_codes', signature: 'days_granted' },
  { table: 'disbursements', signature: 'momo_reference' },
  { table: 'plans', signature: 'weekly_amount_cents' },
  { table: 'items', signature: 'min_weekly_cents' },
  { table: 'suppliers', signature: 'msisdn' },
] as const;

async function clearOwnRows(db: Queryable): Promise<number> {
  for (const { table, signature } of OWNED_TABLES) {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, signature],
    );
    if (rows.length === 0) {
      throw new Error(
        `Table "${table}" exists but has no "${signature}" column, so it belongs to another ` +
          `application. Refusing to delete rows. Point DATABASE_URL at a database of its own ` +
          `and run "npm run migrate" there.`,
      );
    }
  }

  let deleted = 0;
  for (const { table } of OWNED_TABLES) {
    const result = await db.query(`DELETE FROM ${table}`);
    deleted += result.rowCount ?? 0;
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Inserts the repositories deliberately do not expose: explicit ids, and
// payment rows with a chosen created_at/settled_at.
// ---------------------------------------------------------------------------
async function insertSupplier(fixture: SupplierFixture, db: Queryable): Promise<Supplier> {
  const { rows } = await db.query(
    'INSERT INTO suppliers (id, name, msisdn) VALUES ($1, $2, $3) RETURNING *',
    [seedId('supplier', fixture.ref), fixture.name, fixture.msisdn],
  );
  return toSupplier(rows[0]);
}

async function insertItem(fixture: ItemFixture, supplierId: string, db: Queryable): Promise<Item> {
  const { rows } = await db.query(
    `INSERT INTO items (id, supplier_id, title, image_url, price_cents, mode, min_weekly_cents, max_weeks, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      seedId('item', fixture.ref),
      supplierId,
      fixture.title,
      fixture.imageUrl,
      fixture.priceCents,
      fixture.mode,
      fixture.minWeeklyCents,
      fixture.maxWeeks,
      fixture.active ?? true,
    ],
  );
  return toItem(rows[0]);
}

let paymentCount = 0;

async function insertPayment(
  input: {
    planId: string;
    amountCents: number;
    step: Step;
    dueAt: string | null;
    at: Date;
  },
  db: Queryable,
): Promise<string> {
  const momoReference = seedId('payment', ++paymentCount);
  const settled = ((): { status: string; settledAt: Date | null } => {
    switch (input.step) {
      case 'in_flight':
        return { status: 'pending', settledAt: null };
      case 'missed':
        return { status: 'failed', settledAt: new Date(input.at.getTime() + 5_000) };
      case 'late':
        // A day past due is what the record counts as late.
        return {
          status: 'successful',
          settledAt: new Date(Date.parse(input.dueAt ?? input.at.toISOString()) + 90_000_000),
        };
      case 'paid':
        return { status: 'successful', settledAt: new Date(input.at.getTime() + 2_000) };
    }
  })();

  await db.query(
    `INSERT INTO payments
       (plan_id, amount_cents, momo_reference, status, financial_transaction_id,
        failure_reason, due_at, created_at, settled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.planId,
      input.amountCents,
      momoReference,
      settled.status,
      settled.status === 'successful' ? `MOCK-SEED-${paymentCount}` : null,
      input.step === 'missed' ? 'PAYER_LIMIT_REACHED' : null,
      input.dueAt,
      input.at.toISOString(),
      settled.settledAt?.toISOString() ?? null,
    ],
  );

  return momoReference;
}

// ---------------------------------------------------------------------------
// One plan, played through the engine
// ---------------------------------------------------------------------------
interface SeededPlan {
  plan: Plan;
  item: Item;
  note: string;
  pendingPaymentReference: string | null;
}

async function seedPlan(
  fixture: PlanFixture,
  item: Item,
  db: Queryable,
): Promise<SeededPlan> {
  const periodMs = env.BILLING_PERIOD_SECONDS * 1000;
  const quote = quotePlan(item, fixture.weeklyAmountCents);
  // Backdate the start so the last instalment lands about now and the plan is due.
  const startedAt = new Date(Date.now() - fixture.history.length * periodMs);

  const { plan, events } = startPlan({
    id: seedId('plan', fixture.ref),
    item,
    buyerMsisdn: fixture.buyerMsisdn,
    quote,
    now: startedAt,
    periodSeconds: env.BILLING_PERIOD_SECONDS,
  });

  let current = await plansRepo.insert(plan, db);
  await applyEvents(events, { plan: current, now: startedAt }, db);

  let pendingPaymentReference: string | null = null;

  for (const [index, step] of fixture.history.entries()) {
    if (current.status === 'complete') break;

    const at = new Date(startedAt.getTime() + index * periodMs);
    const dueAt = current.nextDueAt;
    const amountCents = nextInstalmentCents(current);

    const reference = await insertPayment({ planId: current.id, amountCents, step, dueAt, at }, db);

    if (step === 'in_flight') {
      // No outcome yet: the plan waits on the callback, exactly as it would live.
      pendingPaymentReference = reference;
      break;
    }

    const outcome =
      step === 'missed'
        ? onMissedPayment({ plan: current, now: at, periodSeconds: env.BILLING_PERIOD_SECONDS })
        : applyPayment({
            plan: current,
            amountCents,
            now: at,
            periodSeconds: env.BILLING_PERIOD_SECONDS,
            daysPerPeriod: env.UNLOCK_DAYS_PER_PERIOD,
          });

    current = await plansRepo.save(outcome.plan, db);
    // Writes unlock codes, collection codes and the disbursement row. The MoMo
    // calls it defers are dropped on purpose — a seed makes no network calls,
    // and payout state is set explicitly below.
    await applyEvents(outcome.events, { plan: current, now: at }, db);
  }

  if (fixture.payout === 'settled') {
    const raised = await disbursementsRepo.findByPlan(current.id, db);
    if (raised) {
      await disbursementsRepo.settle({ momoReference: raised.momoReference, status: 'successful' }, db);
    }
  }

  if (fixture.deviceDark) {
    // A missed week means the live code runs out. On a compressed billing clock
    // its seven real days would still be running, so age it out here to show
    // what the field shows: a dark device until the next successful payment.
    await db.query(
      `UPDATE unlock_codes SET expires_at = now() - INTERVAL '1 minute'
       WHERE plan_id = $1 AND permanent = FALSE
         AND sequence = (SELECT MAX(sequence) FROM unlock_codes WHERE plan_id = $1)`,
      [current.id],
    );
  }

  const saved = await plansRepo.findById(current.id, db);
  return { plan: saved ?? current, item, note: fixture.note, pendingPaymentReference };
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function seed() {
  const { suppliers, items, plans, deleted } = await withTransaction(async (db) => {
    const deleted = await clearOwnRows(db);

    const suppliers = new Map<number, Supplier>();
    for (const fixture of SUPPLIERS) {
      suppliers.set(fixture.ref, await insertSupplier(fixture, db));
    }

    const items = new Map<number, Item>();
    for (const fixture of ITEMS) {
      const supplier = suppliers.get(fixture.supplierRef)!;
      items.set(fixture.ref, await insertItem(fixture, supplier.id, db));
    }

    const plans: SeededPlan[] = [];
    for (const fixture of PLANS) {
      plans.push(await seedPlan(fixture, items.get(fixture.itemRef)!, db));
    }

    return { suppliers: [...suppliers.values()], items: [...items.values()], plans, deleted };
  });

  return { suppliers, items, plans, deleted };
}

// ---------------------------------------------------------------------------
// The cheat sheet: what you need to call the API with
// ---------------------------------------------------------------------------
async function report(seeded: Awaited<ReturnType<typeof seed>>) {
  const base = `http://localhost:${env.PORT}`;

  const plans = await Promise.all(
    seeded.plans.map(async ({ plan, item, note, pendingPaymentReference }) => {
      const code = plan.mode === 'use_it' ? await unlockCodesRepo.latest(plan.id) : null;
      const disbursement =
        plan.mode === 'reserve' ? await disbursementsRepo.findByPlan(plan.id) : null;

      return {
        id: plan.id,
        note,
        itemTitle: item.title,
        mode: plan.mode,
        status: plan.status,
        buyerMsisdn: plan.buyerMsisdn,
        totalCents: plan.totalCents,
        paidCents: plan.paidCents,
        weeklyAmountCents: plan.weeklyAmountCents,
        weeks: plan.weeks,
        missedCount: plan.missedCount,
        nextDueAt: plan.nextDueAt,
        collectionCode: plan.collectionCode,
        unlock: code
          ? {
              code: code.code,
              sequence: code.sequence,
              permanent: code.permanent,
              expiresAt: code.expiresAt,
              locked:
                !code.permanent &&
                code.expiresAt !== null &&
                Date.parse(code.expiresAt) <= Date.now(),
            }
          : null,
        disbursementStatus: disbursement?.status ?? null,
        pendingPaymentReference,
      };
    }),
  );

  const summary = {
    seededAt: new Date().toISOString(),
    billingPeriodSeconds: env.BILLING_PERIOD_SECONDS,
    momoProvider: env.MOMO_PROVIDER,
    baseUrl: `${base}/api/v1`,
    suppliers: seeded.suppliers.map((s) => ({ id: s.id, name: s.name, msisdn: s.msisdn })),
    items: seeded.items.map((i) => ({
      id: i.id,
      title: i.title,
      mode: i.mode,
      priceCents: i.priceCents,
      minWeeklyCents: i.minWeeklyCents,
      maxWeeks: i.maxWeeks,
      active: i.active,
      supplierId: i.supplierId,
    })),
    buyers: Object.entries(BUYERS).map(([name, msisdn]) => ({
      name,
      msisdn,
      plans: plans.filter((p) => p.buyerMsisdn === msisdn).map((p) => p.id),
    })),
    plans,
  };

  const out = resolve(process.cwd(), 'seed-data.json');
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const lines: string[] = [];
  lines.push('');
  lines.push(`Seeded ${summary.suppliers.length} suppliers, ${summary.items.length} items, ${plans.length} plans.`);
  lines.push(`Billing period: ${env.BILLING_PERIOD_SECONDS}s per "week". MoMo provider: ${env.MOMO_PROVIDER}.`);
  lines.push('');
  lines.push('SUPPLIERS');
  for (const s of summary.suppliers) {
    lines.push(`  ${s.id}  ${s.msisdn}  ${s.name}`);
  }
  lines.push('');
  lines.push('ITEMS');
  for (const i of summary.items) {
    const flag = i.active ? '' : '  (de-listed)';
    lines.push(`  ${i.id}  ${i.mode.padEnd(7)} ${money(i.priceCents).padStart(9)}  ${i.title}${flag}`);
  }
  lines.push('');
  lines.push('PLANS');
  for (const p of plans) {
    lines.push(`  ${p.id}  ${p.mode.padEnd(7)} ${p.status.padEnd(8)} ${money(p.paidCents)}/${money(p.totalCents)}  ${p.buyerMsisdn}  ${p.itemTitle}`);
    lines.push(`    ${p.note}`);
    if (p.collectionCode) lines.push(`    collection code: ${p.collectionCode}   payout: ${p.disbursementStatus}`);
    else if (p.disbursementStatus) lines.push(`    payout: ${p.disbursementStatus}`);
    if (p.unlock) {
      lines.push(
        p.unlock.permanent
          ? `    unlock: ${p.unlock.code} (permanent)`
          : `    unlock: ${p.unlock.code} seq ${p.unlock.sequence}, ${p.unlock.locked ? 'EXPIRED — device locked' : `live until ${p.unlock.expiresAt}`}`,
      );
    }
    if (p.pendingPaymentReference) {
      lines.push(`    payment awaiting confirmation: ${p.pendingPaymentReference}`);
    }
  }
  lines.push('');
  lines.push('TRY IT');
  lines.push(`  curl ${base}/health`);
  lines.push(`  curl ${base}/api/v1/items`);
  lines.push(`  curl ${base}/api/v1/items?mode=use_it`);
  lines.push(`  curl ${base}/api/v1/items/${summary.items[0]!.id}/plan-options`);
  lines.push(`  curl ${base}/api/v1/suppliers/${summary.suppliers[0]!.id}/plans`);
  lines.push(`  curl ${base}/api/v1/plans/${plans[1]!.id}`);
  lines.push(`  curl ${base}/api/v1/buyers/${BUYERS.thabo}/plans`);
  lines.push(`  curl ${base}/api/v1/records/${BUYERS.sipho}`);
  const useIt = plans.find((p) => p.unlock && !p.unlock.permanent && !p.unlock.locked);
  if (useIt) lines.push(`  curl ${base}/api/v1/plans/${useIt.id}/unlock`);
  const inFlight = plans.find((p) => p.pendingPaymentReference);
  if (inFlight) {
    lines.push('');
    lines.push('  # settle the in-flight collection the way MoMo would');
    lines.push(
      `  curl -X POST ${base}/webhooks/momo/collection/${inFlight.pendingPaymentReference} \\\n       -H 'content-type: application/json' -d '{"status":"SUCCESSFUL"}'`,
    );
  }
  lines.push('');
  lines.push(`Full reference written to ${out}`);
  lines.push('');

  console.log(lines.join('\n'));

  logger.info('seed.complete', {
    deleted: seeded.deleted,
    suppliers: summary.suppliers.length,
    items: summary.items.length,
    plans: plans.length,
    payments: paymentCount,
  });
}

seed()
  .then(report)
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('seed.failed', { error: (err as Error).message });
    process.exit(1);
  });
