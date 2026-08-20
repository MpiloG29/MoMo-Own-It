import { env } from '../config/env.js';
import { LiveMomoProvider } from './client.js';
import { MockMomoProvider } from './mock.js';
import type { MomoProvider } from './types.js';

let provider: MomoProvider | null = null;

export function momo(): MomoProvider {
  if (!provider) {
    provider = env.MOMO_PROVIDER === 'live' ? new LiveMomoProvider() : new MockMomoProvider();
  }
  return provider;
}

/** Tests and the demo kill-switch swap the provider at runtime. */
export function setMomoProvider(next: MomoProvider): void {
  provider = next;
}

export { MockMomoProvider, LiveMomoProvider };
export * from './types.js';
export { newReferenceId, MomoError } from './client.js';
