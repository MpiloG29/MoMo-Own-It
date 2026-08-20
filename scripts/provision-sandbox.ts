import { randomUUID } from 'node:crypto';

/**
 * Creates a MoMo sandbox API user and key, for Collections and Disbursements.
 *
 * Run this once, before the event, and paste the output into .env. Doing the
 * provisioning dance cold at 2am is how teams lose their first three hours.
 *
 *   MOMO_COLLECTION_SUBSCRIPTION_KEY=... \
 *   MOMO_DISBURSEMENT_SUBSCRIPTION_KEY=... \
 *   MOMO_PROVIDER_CALLBACK_HOST=example.com \
 *   npm run provision:sandbox
 */

const BASE = process.env.MOMO_BASE_URL ?? 'https://sandbox.momodeveloper.mtn.com';
const CALLBACK_HOST = process.env.MOMO_PROVIDER_CALLBACK_HOST ?? 'example.com';

async function provision(product: string, subscriptionKey: string): Promise<void> {
  if (!subscriptionKey) {
    console.error(`Skipping ${product}: no subscription key in the environment.`);
    return;
  }

  const referenceId = randomUUID();

  const created = await fetch(`${BASE}/v1_0/apiuser`, {
    method: 'POST',
    headers: {
      'X-Reference-Id': referenceId,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ providerCallbackHost: CALLBACK_HOST }),
  });

  if (!created.ok) {
    console.error(`${product}: apiuser creation failed (${created.status})`, await created.text());
    return;
  }

  const keyRes = await fetch(`${BASE}/v1_0/apiuser/${referenceId}/apikey`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': subscriptionKey, 'Content-Length': '0' },
  });

  if (!keyRes.ok) {
    console.error(`${product}: apikey creation failed (${keyRes.status})`, await keyRes.text());
    return;
  }

  const { apiKey } = (await keyRes.json()) as { apiKey: string };

  const prefix = product.toUpperCase();
  console.log(`\n# ${product}`);
  console.log(`MOMO_${prefix}_API_USER=${referenceId}`);
  console.log(`MOMO_${prefix}_API_KEY=${apiKey}`);
}

await provision('collection', process.env.MOMO_COLLECTION_SUBSCRIPTION_KEY ?? '');
await provision('disbursement', process.env.MOMO_DISBURSEMENT_SUBSCRIPTION_KEY ?? '');
