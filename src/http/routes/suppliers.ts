import { Router } from 'express';
import * as suppliersRepo from '../../repositories/suppliers.js';
import * as plansRepo from '../../repositories/plans.js';
import * as itemsRepo from '../../repositories/items.js';
import * as disbursementsRepo from '../../repositories/disbursements.js';
import { notFound } from '../../domain/errors.js';
import { param } from '../params.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createSupplierSchema } from '../validation.js';

export const suppliersRouter = Router();

suppliersRouter.post(
  '/suppliers',
  asyncHandler(async (req, res) => {
    const body = createSupplierSchema.parse(req.body);
    res.status(201).json(await suppliersRepo.create(body));
  }),
);

suppliersRouter.get(
  '/suppliers',
  asyncHandler(async (_req, res) => {
    res.json(await suppliersRepo.list());
  }),
);

/**
 * The supplier's whole view: what they listed, every plan running against it,
 * and — for Reserve plans — whether the completion payout has actually landed.
 */
suppliersRouter.get(
  '/suppliers/:id/plans',
  asyncHandler(async (req, res) => {
    const supplier = await suppliersRepo.findById(param(req, 'id'));
    if (!supplier) throw notFound('Supplier');
    const [items, plans, disbursements] = await Promise.all([
      itemsRepo.list({ supplierId: supplier.id }),
      plansRepo.listBySupplier(supplier.id),
      disbursementsRepo.listBySupplier(supplier.id),
    ]);
    res.json({ supplier, items, plans, disbursements });
  }),
);
