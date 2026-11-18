# verify: paper-trading-ledger-ops-1576

Task #1576 — BE: Ledger ops — `deletePaperTrades` cascade + ingest
curated dims + PRIMARY/SECONDARY widening.

## `paper-trading-ledger-ops-1576.ts`

Fixture-mode checks — the real `deleteTradeCascade` repository seam over
an in-memory doc store, the real `handleDeletePaperTrades` handler, and
the real `runAutoPaperIngestFill` with dep fakes (the emitted
`EntryFillInput` dims are asserted field-by-field). No credentials, no
network.

```bash
cd functions
npx tsx scripts/verify/paper-trading-ledger-ops-1576.ts
```

### What it checks (36 checks)

**Static seams** — `deleteTradeCascade` exported from repository.ts;
`handleDeletePaperTrades` + `deletePaperTrades` onCall in
signal-trade-callables.ts; callable registered in `index.ts`;
`CURATED_GOVERNING_POLICY` + `CURATED_VARIANT_KEYS` in the ingest pass;
spec registered in `test:paper-trading`; `DELETE_PAPER_TRADES_MAX_ITEMS`
= 50.

**Cascade** — signal trade + `pap_{tradeId}` + `rq-*` docs all
deleted; foreign raw quotes survive; re-delete reports `notFound`
(idempotent); a `source=STRATEGY` trade is refused (`non-signal`) with
nothing touched; an accept-flow trade (`cohortId` marker) refuses
(`accept-flow`) with nothing touched; a lifecycle-open delete rewinds
`acct-{userId}.openTradeCount`; a missing id reports `notFound`.

**Callable** — `unauthenticated` without auth; `invalid-argument` past
the 50-item cap; per-item `deleted` / `notFound` / `failed` bucketing.

**Ingest dims** — `runAutoPaperIngestFill` emits `governingPolicy =
'deepest-stop-else-trailing-8'`, `governingVariant = 'trailing-8'` (the
policy fallback seed), `variantKeys = CURATED_VARIANT_KEYS`; a
PRIMARY+SECONDARY scope admits a SECONDARY-only member stamped
`captureList: 'SECONDARY'`; an unlisted candidate is filtered.

### Expected output

`All 36 checks passed.` — a `✗` line names the check and the
got-vs-want values.

## Config widening — prod doc state (not a script check)

The `st-config/autoPaper` `lists` widening is a **document edit**, not
code — verified by reading the doc directly:

```bash
cd functions && GOOGLE_CLOUD_PROJECT=rel-str npx tsx -e "import {db} from './src/firebase-admin-init'; db.collection('st-config').doc('autoPaper').get().then((d:{data:()=>unknown})=>{console.log(d.data());process.exit(0)});"
```

(needs ADC; or read `st-config/autoPaper` in the Firestore console —
`lists` must contain `SECONDARY`).

As of 2026-11-18 the prod doc reads
`lists: ["PRIMARY","SECONDARY"]` on `{ownerUid}_`-scoped lists — a probe
earlier that day found a stray `MONITOR`+`NEW` widening (~490 extra
symbols in capture scope); confirmed unintended and trimmed same-day.
