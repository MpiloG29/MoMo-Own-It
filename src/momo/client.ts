import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import type {
  MomoProvider,
  RequestToPayInput,
  TransactionStatus,
  TransferInput,
} from './types.js';

/**
 * MoMo Open API client — Collections + Disbursements.
 *
 * Two things eat hours if you meet them cold at 2am:
 *   1. Access tokens are per-product (collection and disbursement are separate).
 *   2. X-Reference-Id is the idempotency key AND the only handle on the
 *      transaction afterwards. Generate it, persist it, then call.
 */

type Product = 'collection' | 'disbursement';

interface Credentials {
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const credentials: Record<Product, Credentials> = {
  collection: {
    subscriptionKey: env.MOMO_COLLECTION_SUBSCRIPTION_KEY,
    apiUser: env.MOMO_COLLECTION_API_USER,
    apiKey: env.MOMO_COLLECTION_API_KEY,
  },
  disbursement: {
    subscriptionKey: env.MOMO_DISBURSEMENT_SUBSCRIPTION_KEY,
    apiUser: env.MOMO_DISBURSEMENT_API_USER,
    apiKey: env.MOMO_DISBURSEMENT_API_KEY,
  },
};

const tokens = new Map<Product, CachedToken>();

export class MomoError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'MomoError';
  }
}

/** MoMo takes major units as a string. We hold cents; convert at the edge only. */
function toAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

async function accessToken(product: Product): Promise<string> {
  const cached = tokens.get(product);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const { subscriptionKey, apiUser, apiKey } = credentials[product];
  const basic = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');

  const res = await fetch(`${env.MOMO_BASE_URL}/${product}/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Content-Length': '0',
    },
  });

  const body = await res.text();
  if (!res.ok) throw new MomoError(res.status, body, `Token request failed for ${product}`);

  const parsed = JSON.parse(body) as { access_token: string; expires_in: number };
  tokens.set(product, {
    token: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
  });
  return parsed.access_token;
}

async function call(
  product: Product,
  path: string,
  init: { method: string; body?: unknown; referenceId?: string },
): Promise<Response> {
  const token = await accessToken(product);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Ocp-Apim-Subscription-Key': credentials[product].subscriptionKey,
    'X-Target-Environment': env.MOMO_TARGET_ENVIRONMENT,
  };
  if (init.referenceId) headers['X-Reference-Id'] = init.referenceId;
  if (init.body) headers['Content-Type'] = 'application/json';
  if (env.MOMO_CALLBACK_URL && init.method === 'POST') {
    headers['X-Callback-Url'] = env.MOMO_CALLBACK_URL;
  }

  const res = await fetch(`${env.MOMO_BASE_URL}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new MomoError(res.status, text, `${init.method} ${path} failed (${res.status})`);
  }
  return res;
}

interface MomoStatusBody {
  status?: string;
  financialTransactionId?: string;
  reason?: unknown;
}

function normaliseStatus(raw: MomoStatusBody, referenceId: string): TransactionStatus {
  const status = raw.status === 'SUCCESSFUL' ? 'SUCCESSFUL' : raw.status === 'FAILED' ? 'FAILED' : 'PENDING';
  const reason =
    typeof raw.reason === 'string'
      ? raw.reason
      : raw.reason && typeof raw.reason === 'object'
        ? JSON.stringify(raw.reason)
        : null;
  return {
    referenceId,
    status,
    financialTransactionId: raw.financialTransactionId ?? null,
    reason,
  };
}

export class LiveMomoProvider implements MomoProvider {
  readonly name = 'live' as const;

  async requestToPay(input: RequestToPayInput): Promise<void> {
    await call('collection', '/collection/v1_0/requesttopay', {
      method: 'POST',
      referenceId: input.referenceId,
      body: {
        amount: toAmount(input.amountCents),
        currency: env.MOMO_CURRENCY,
        externalId: input.externalId,
        payer: { partyIdType: 'MSISDN', partyId: input.payerMsisdn },
        payerMessage: input.payerMessage.slice(0, 160),
        payeeNote: input.payeeNote.slice(0, 160),
      },
    });
    logger.info('momo.requestToPay.accepted', { referenceId: input.referenceId });
  }

  async getRequestToPayStatus(referenceId: string): Promise<TransactionStatus> {
    const res = await call('collection', `/collection/v1_0/requesttopay/${referenceId}`, {
      method: 'GET',
    });
    return normaliseStatus((await res.json()) as MomoStatusBody, referenceId);
  }

  async transfer(input: TransferInput): Promise<void> {
    await call('disbursement', '/disbursement/v1_0/transfer', {
      method: 'POST',
      referenceId: input.referenceId,
      body: {
        amount: toAmount(input.amountCents),
        currency: env.MOMO_CURRENCY,
        externalId: input.externalId,
        payee: { partyIdType: 'MSISDN', partyId: input.payeeMsisdn },
        payerMessage: input.payerMessage.slice(0, 160),
        payeeNote: input.payeeNote.slice(0, 160),
      },
    });
    logger.info('momo.transfer.accepted', { referenceId: input.referenceId });
  }

  async getTransferStatus(referenceId: string): Promise<TransactionStatus> {
    const res = await call('disbursement', `/disbursement/v1_0/transfer/${referenceId}`, {
      method: 'GET',
    });
    return normaliseStatus((await res.json()) as MomoStatusBody, referenceId);
  }

  async isAccountActive(msisdn: string): Promise<boolean> {
    try {
      const res = await call('collection', `/collection/v1_0/accountholder/msisdn/${msisdn}/active`, {
        method: 'GET',
      });
      const body = (await res.json()) as { result?: boolean } | boolean;
      return typeof body === 'boolean' ? body : Boolean(body.result);
    } catch (err) {
      if (err instanceof MomoError && err.status === 404) return false;
      throw err;
    }
  }
}

export function newReferenceId(): string {
  return randomUUID();
}
