import { Router } from 'express';
import { notFound } from '../../domain/errors.js';
import * as itemsRepo from '../../repositories/items.js';
import * as planService from '../../services/planService.js';
import { param } from '../params.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createItemSchema } from '../validation.js';

export const itemsRouter = Router();

itemsRouter.post(
  '/items',
  asyncHandler(async (req, res) => {
    const body = createItemSchema.parse(req.body);
    res.status(201).json(await itemsRepo.create(body));
  }),
);

itemsRouter.get(
  '/items',
  asyncHandler(async (req, res) => {
    const mode = req.query.mode === 'reserve' || req.query.mode === 'use_it' ? req.query.mode : undefined;
    res.json(await itemsRepo.list({ mode }));
  }),
);

itemsRouter.get(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const item = await itemsRepo.findById(param(req, 'id'));
    if (!item) throw notFound('Item');
    res.json(item);
  }),
);

/** Every plan the supplier's limits allow — this is the buyer's choice screen. */
itemsRouter.get(
  '/items/:id/plan-options',
  asyncHandler(async (req, res) => {
    res.json(await planService.options(param(req, 'id')));
  }),
);
