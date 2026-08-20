import { Router } from 'express';
import { z } from 'zod';
import * as collectionService from '../../services/collectionService.js';
import * as disbursementService from '../../services/disbursementService.js';
import * as planService from '../../services/planService.js';
import * as unlockService from '../../services/unlockService.js';
import { param } from '../params.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createPlanSchema, msisdn, payAheadSchema } from '../validation.js';

export const plansRouter = Router();

plansRouter.post(
  '/plans',
  asyncHandler(async (req, res) => {
    const body = createPlanSchema.parse(req.body);
    const plan = await planService.create(body);

    // The plan starts when money moves — collect instalment one immediately.
    const collection = await collectionService.requestInstalment(plan.id);
    res.status(201).json({ plan, collection });
  }),
);

plansRouter.get(
  '/plans/:id',
  asyncHandler(async (req, res) => {
    res.json(await planService.view(param(req, 'id')));
  }),
);

plansRouter.get(
  '/buyers/:msisdn/plans',
  asyncHandler(async (req, res) => {
    const buyer = msisdn.parse(param(req, 'msisdn'));
    res.json(await planService.listByBuyer(buyer));
  }),
);

plansRouter.post(
  '/plans/:id/pay-ahead',
  asyncHandler(async (req, res) => {
    const { amountCents } = payAheadSchema.parse(req.body ?? {});
    res.status(202).json(await collectionService.payAhead(param(req, 'id'), amountCents));
  }),
);

plansRouter.get(
  '/plans/:id/unlock',
  asyncHandler(async (req, res) => {
    res.json(await unlockService.currentFor(param(req, 'id')));
  }),
);

plansRouter.get(
  '/plans/:id/unlock/history',
  asyncHandler(async (req, res) => {
    res.json(await unlockService.listFor(param(req, 'id')));
  }),
);

/**
 * Demo controls. Deliberately separate from the buyer-facing surface so they
 * are trivial to strip before anything goes near production.
 */
const demoRouter = Router();

demoRouter.post(
  '/demo/plans/:id/collect-now',
  asyncHandler(async (req, res) => {
    res.status(202).json(await collectionService.requestInstalment(param(req, 'id')));
  }),
);

demoRouter.post(
  '/demo/plans/:id/miss',
  asyncHandler(async (req, res) => {
    res.json(await collectionService.forceMiss(param(req, 'id')));
  }),
);

/** Ask MoMo how one plan's in-flight collection resolved. */
demoRouter.post(
  '/demo/plans/:id/settle',
  asyncHandler(async (req, res) => {
    res.json({ settled: await collectionService.reconcilePlan(param(req, 'id')) });
  }),
);

demoRouter.post(
  '/demo/tick',
  asyncHandler(async (_req, res) => {
    const collected = await collectionService.runDueCollections();
    const settled = await collectionService.reconcilePending(0);
    const disbursed = await disbursementService.reconcilePending(0);
    res.json({ collected, settled, disbursed });
  }),
);

demoRouter.post(
  '/demo/unlock/verify',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        planId: z.string().uuid(),
        code: z.string().regex(/^\d{6,12}$/),
        lastAcceptedSequence: z.number().int().min(0).default(0),
      })
      .parse(req.body);
    res.json(unlockService.verifyForDevice(body));
  }),
);

plansRouter.use(demoRouter);
