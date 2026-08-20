# MoMo Own It — backend

Layby and pay-as-you-go, running as one payment engine on MTN MoMo.

Two modes, one codebase:

| | **Reserve** (layby) | **Use It** (pay-as-you-go) |
|---|---|---|
| Who holds the item | Supplier | Customer, from day one |
| If payments stop | Plan pauses, nothing is lost | Device locks until payments resume |
| Supplier is paid | Once, on completion | Upfront or progressively |
| Legal shape | Deposit arrangement (CPA) | Instalment credit agreement (NCA) |

The mode is a flag, not a second codebase. It forks the logic in exactly two
places, both in [`src/domain/plan.ts`](src/domain/plan.ts):

1. `possessionFor()` — at plan start, does the item release now or is it held?
2. `onMissedPayment()` — on a miss, does something switch off, or does the plan stretch?

Everything else — collection, ledger, progress, reminders, completion,
record-building — is shared.

## Run it

```bash
cp .env.example .env        # fill it in; see the notes below
docker compose up -d db
npm install
npm run migrate
npm run seed
npm run dev
```

`GET /health` tells you whether the database is up and which MoMo provider is live.

## Seed data

`npm run seed` fills an empty database with three suppliers, nine items and
eight plans — one per state the engine can be in: a plan that just started, one
mid-way with a late payment, a Reserve plan completed and paid out, another
completed whose payout callback never landed, a Use It plan running with a live
unlock code, one behind with a dark device, one paid off and permanently
unlocked, and one with a collection still awaiting confirmation.

Every fixture is produced by running the real engine over a backdated clock, so
ledgers, progress, unlock codes, collection codes and payout rows are exactly
what the API would have written had the demo run for real. Timing follows
`BILLING_PERIOD_SECONDS`, which means each plan's next instalment falls due
about now and `POST /api/v1/demo/tick` has something to do immediately.

It prints the ids, msisdns and codes you need to call the API and writes the
same thing to `seed-data.json`. Seeded rows carry recognisable ids —
`5eed0002-…-000000000004` is item four — so saved requests survive a re-seed.

Re-running replaces the previous data: the seed deletes the rows in its own six
tables first, and refuses to touch a table that does not carry this schema's
columns.

## Web

Static files in [`public/`](public) are served by the same Express app, so the
port in `PORT` serves both the buyer-facing UI and `/api/v1/*`. Pages call the
API by path, never by origin: no build step, no second dev server, no CORS.

| Page | What it is |
|---|---|
| `/` | sign in |
| `/dashboard` | buyer home: every plan on this number, and the record so far |
| `/shop` | browse by mode, expand an item into the plans its limits allow |
| `/item?id=` | plan builder: pick an instalment, start the plan |
| `/plan?id=` | one plan: progress, ledger, unlock code or collection code, pay ahead |
| `/record` | the repayment record, and the download that makes it the customer's |
| `/supplier` | supplier console: listings, plans, payouts, list a new item |
| `/device?plan=` | the keypad, running the same check the firmware runs |
| `/demo` | presenter controls: advance the clock, force a miss, confirm a payment |

**The sign-in is a stub.** Identity in this system is an MSISDN and nothing else —
there is no account, no credential, and no route that checks one — so the screen
validates the shape of a mobile number, accepts any password, and keeps the
number in `sessionStorage`. `public/js/session.js` is the single place to swap in
a real token once an auth endpoint exists.

## Environment notes

| Variable | Why it matters |
|---|---|
| `MOMO_PROVIDER` | `mock` runs the whole engine with no network and no credentials. `live` hits the MoMo sandbox. Start on `mock`. |
| `MOMO_CURRENCY` | The MoMo sandbox only settles `EUR`. Change it only when you change target environment. |
| `BILLING_PERIOD_SECONDS` | `604800` is a real week. Set it to `20` on stage and a 20-week plan completes inside the demo. |
| `UNLOCK_HMAC_SECRET` | Master secret for unlock codes. Per-plan device keys are derived from it. |

## MoMo sandbox, before the event

Registering the API user and minting keys eats hours if you meet it cold at 2am.
Do it once, in advance:

```bash
MOMO_COLLECTION_SUBSCRIPTION_KEY=... \
MOMO_DISBURSEMENT_SUBSCRIPTION_KEY=... \
MOMO_PROVIDER_CALLBACK_HOST=your-host \
npm run provision:sandbox
```

It prints `MOMO_*_API_USER` and `MOMO_*_API_KEY` lines to paste into `.env`.

**The one thing to verify in sandbox:** whether a pre-authorised recurring
mandate exists, or whether every collection needs a per-transaction PIN
confirmation. If it is the latter, "auto-debit" becomes "we prompt at exactly
the right moment and track everything" — the product still holds, but the copy
changes. Nothing else in the build depends on the answer; the collection loop is
the same either way.

## API

| Method | Path | |
|---|---|---|
| `GET` | `/health` | liveness + db + provider |
| `POST` | `/api/v1/suppliers` | register a supplier |
| `GET` | `/api/v1/suppliers/:id/plans` | supplier dashboard: items, plans, and disbursement (payout) status |
| `POST` | `/api/v1/items` | list an item with its plan limits |
| `GET` | `/api/v1/items?mode=reserve\|use_it` | browse |
| `GET` | `/api/v1/items/:id/plan-options` | every plan the supplier's limits allow |
| `POST` | `/api/v1/plans` | start a plan (collects instalment one immediately) |
| `GET` | `/api/v1/plans/:id` | plan, progress, ledger, unlock state, disbursement state |
| `POST` | `/api/v1/plans/:id/pay-ahead` | buyer pays early |
| `GET` | `/api/v1/plans/:id/unlock` | current code and whether the device is locked |
| `GET` | `/api/v1/buyers/:msisdn/plans` | buyer's plans |
| `GET` | `/api/v1/records/:msisdn` | repayment record |
| `GET` | `/api/v1/records/:msisdn/export` | the customer's downloadable copy |
| `POST` | `/webhooks/momo/collection/:referenceId?` | MoMo callback |
| `POST` | `/webhooks/momo/disbursement/:referenceId?` | MoMo callback |

Demo controls, kept separate so they are trivial to strip:

| `POST` | `/api/v1/demo/tick` | run one collection cycle now |
| `POST` | `/api/v1/demo/plans/:id/settle` | ask MoMo how this plan's in-flight collection resolved |
| `POST` | `/api/v1/demo/plans/:id/collect-now` | force a collection |
| `POST` | `/api/v1/demo/plans/:id/miss` | fail the in-flight payment — the lamp goes dark |
| `POST` | `/api/v1/demo/unlock/verify` | the device-side check, over HTTP |

## Design decisions worth knowing

**Money is integer cents, everywhere.** Conversion to MoMo's decimal string
happens once, at the edge of the client.

**`X-Reference-Id` is the idempotency key.** A `payments` row is written with
its reference *before* `requestToPay` is called, under a unique constraint. A
replayed callback settles nothing twice; a dropped callback is caught by the
poller in `reconcilePending`.

**Outbound calls never happen inside a transaction.** The domain returns
events, the transaction commits, then side effects dispatch. A dropped
disbursement callback leaves a `pending` row; `disbursementService.reconcilePending`
polls it the same way `collectionService.reconcilePending` polls stuck
collections — both run on every scheduler tick and every `/demo/tick`, so
nothing is settled only by hoping a webhook lands.

**Unlock codes are offline.** `HMAC(deviceKey, sequence:days)` truncated to nine
digits, RFC-4226 style. No signal, no data, no smartphone — which is why the
model works in the field. The sequence blocks replay; the device only accepts a
code newer than the last one it took. `verifyCode()` is the exact check the
ESP32 runs, kept here so firmware and backend test against the same vectors.

**The repayment record is derived, never authored.** It is a query over what
actually happened. Not a requirement, not a gate, not ours.

## Tests

```bash
npm test
```

No database or network required — the engine, the code scheme and the payment
provider are all tested in isolation. Covers plan quoting against supplier
limits, rounding into the final instalment, the shared ledger, both completion
paths, both miss behaviours, replay rejection, and permanent unlock.

## Deliberately not built

Authentication and accounts, variable payment amounts, multi-supplier search and
ratings, refund and cancellation flows, real device provisioning at scale, and
balance prediction
(third parties do not get visibility into a customer's wallet — we send a
reminder before the due date instead).

## Not legal advice

Reserve is structured as a deposit arrangement; Use It as instalment credit. In
both cases the supplier is the principal and this service is the payment and
servicing rail. Any commercial deployment needs the agreements reviewed, credit
provider registration confirmed on the supplier side, and Reserve balances held
in a segregated trust account with a documented refund policy.
