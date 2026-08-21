# MoMo Own It — backend

Layby and pay-as-you-go, running as one payment engine on MTN MoMo.

Two modes, one codebase:

| | **Reserve** (layby) | **Take It Now** (pay-as-you-go) |
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

Needs Node 20+ and Docker.

```bash
cp .env.example .env        # working demo defaults, nothing to fill in
docker compose up -d db     # wait for it to report healthy
npm install
npm run migrate
npm run seed
npm run dev
```

Then open <http://localhost:8090>. `GET /health` tells you whether the database
is up and which MoMo provider is live.

The copied `.env` runs entirely on `MOMO_PROVIDER=mock` — no MoMo credentials, no
network — with the billing clock at twenty seconds per "week" so plans move while
you watch. Two of its values are what make the demo *live* rather than static:
`SCHEDULER_ENABLED=true` and `BILLING_PERIOD_SECONDS=20`. With the scheduler off,
or the clock at a real week, everything loads and then nothing ever happens.

**If port 5432 is already taken** — you have Postgres installed natively — `docker
compose up` fails to bind. Publish the container somewhere else instead:

```bash
cat > docker-compose.override.yml <<'EOF'
services:
  db:
    ports:
      - "5455:5432"
EOF
```

Then point `DATABASE_URL` at 5455 in your `.env`. The override file is gitignored,
so it stays local to your machine.

To wipe the database and start over — also what to run after editing
`001_init.sql`, since migrations are tracked by filename and an edited one never
re-applies:

```bash
npm run db:reset            # drop, migrate, seed
```

## Seed data

`npm run seed` fills an empty database with three suppliers, nine items and
eight plans — one per state the engine can be in: a plan that just started, one
mid-way with a late payment, a Reserve plan completed and paid out, another
completed whose payout callback never landed, a Take It Now plan running with a live
unlock code, one behind with a dark device, one paid off and permanently
unlocked, and one with a collection still awaiting confirmation.

Every fixture is produced by running the real engine over a backdated clock, so
ledgers, progress, unlock codes, collection codes and payout rows are exactly
what the API would have written had the demo run for real. Timing follows
`BILLING_PERIOD_SECONDS`, which means each plan's next instalment falls due
about now and the collection loop has something to do immediately.

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
| `GET` | `/api/v1/items?mode=reserve\|take_it_now` | browse |
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

Presenter-only controls used by the demo screens are mounted on their own router,
undocumented here and removable in a single line before any deployment.

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
collections — both run on every scheduler tick, so
nothing is settled only by hoping a webhook lands.

**Unlock codes are offline.** `HMAC(deviceKey, sequence:days)` truncated to nine
digits, RFC-4226 style. No signal, no data, no smartphone — which is why the
model works in the field. The sequence blocks replay; the device only accepts a
code newer than the last one it took. `verifyCode()` is the exact check the
ESP32 runs, kept here so firmware and backend test against the same vectors.

**The repayment record is derived, never authored.** It is a query over what
actually happened. Not a requirement, not a gate, not ours.

## Deliberately not built

This is a skeleton. It demonstrates the engine and the shape of the system, not
a finished product. The following are described in the concept but are **not in
this codebase** — they are named here so the gap is stated rather than
discovered:

| Not built | Note |
|---|---|
| **Due-date reminders** | The concept sends a nudge before each collection. Nothing here schedules or sends one; the scheduler only collects. |
| **SMS delivery of unlock codes** | Codes are generated and returned over the API and shown in the UI. There is no SMS gateway integration, so "sent by SMS" is not yet true. |
| **KYC re-verification on a changed number** | Identity is an MSISDN and nothing else. No MoMo KYC call exists, so changing a number is not detected or challenged. |
| **Reserve expiry, refund and the supplier holding fee** | `PlanStatus` includes `cancelled` and the database constrains for it, but no code path sets it. The expiry-and-split rule is designed, not implemented. |
| **Trust account separation for Reserve balances** | A deployment requirement, not a code feature. Funds flow through MoMo; nothing here segregates them. |
| **Device-fault pause** | A genuine hardware fault should pause a plan without touching the record. No pause state exists. |
| **Missed-scheduling attribution** | Our own scheduler failures should be logged as our fault, never counted against the buyer. Misses are currently recorded the same way whatever the cause. |
| **Authentication and accounts** | The sign-in is a stub; no route checks a credential. |
| **Variable payment amounts** | A plan has one instalment size, fixed at start. |
| **Multi-supplier search and ratings** | Browse is a flat list filtered by mode. |
| **Real device provisioning at scale** | Unlock codes are correct and offline-verifiable, but there is no fleet, key rotation or firmware pipeline. |
| **Balance prediction** | Deliberate, not missing: third parties do not get visibility into a customer's wallet. The concept sends a reminder before the due date instead — see the first row. |

## Not legal advice

Reserve is structured as a deposit arrangement; Take It Now as instalment credit. In
both cases the supplier is the principal and this service is the payment and
servicing rail. Any commercial deployment needs the agreements reviewed, credit
provider registration confirmed on the supplier side, and Reserve balances held
in a segregated trust account with a documented refund policy.
