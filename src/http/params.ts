import type { Request } from 'express';
import { invalid } from '../domain/errors.js';

/** `noUncheckedIndexedAccess` is on for a reason — path params are checked here, once. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid('MISSING_PARAM', `Path parameter "${name}" is required.`);
  }
  return value;
}

export function optionalParam(req: Request, name: string): string | undefined {
  const value = req.params[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
