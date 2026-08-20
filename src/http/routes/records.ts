import { Router } from 'express';
import * as recordService from '../../services/recordService.js';
import { param } from '../params.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { msisdn } from '../validation.js';

export const recordsRouter = Router();

recordsRouter.get(
  '/records/:msisdn',
  asyncHandler(async (req, res) => {
    res.json(await recordService.forBuyer(msisdn.parse(param(req, 'msisdn'))));
  }),
);

/** The customer's copy. Downloadable, self-contained, theirs. */
recordsRouter.get(
  '/records/:msisdn/export',
  asyncHandler(async (req, res) => {
    const buyer = msisdn.parse(param(req, 'msisdn'));
    const doc = await recordService.exportFor(buyer);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="repayment-record-${buyer}.json"`);
    res.send(JSON.stringify(doc, null, 2));
  }),
);
