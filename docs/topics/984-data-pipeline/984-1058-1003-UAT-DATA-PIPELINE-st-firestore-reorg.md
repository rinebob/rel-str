**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1058  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1003  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

# UAT — BE-IMPL: order-intents dual-write + migration + cutover (#1003)

## Scope

Soak-period dual-write, one-shot backfill, and canonical-first reads for
`order-intents` → `st-order-tickets`:

- `legacyIntentToTicket` — pure mapper (status→`mode`/`state` via
  `mapLegacyTicketStatus`, terms normalization + fractional-equity gate,
  origin/signalContext/tracking lineage, `migratedFrom`, fillSummary only
  with a real fill date; malformed docs → `error`).
- `orderIntentsMirror` — onDocumentWritten dual-write; Firestore txn
  (reads-before-writes) does terminal-wins suppression, `updatedAt`
  non-regression, and opposite-prefix (`liv_`/`pap_`) orphan cleanup;
  legacy deletes remove both candidates; malformed events fail-soft.
- `getTicketDoc` — canonical-first `refId` query (prefers
  `migratedFrom` order docs, rejects `expression`/`expressionTemplate`/
  terms-less siblings), legacy fallback, `stTicketToOrderTicketDoc`
  adapter.
- `functions/scripts/migrate-order-intents-1003.ts` — dry-run by default;
  `--apply` batches mapped tickets, settles paper modes from linked
  trades (top-level `expression === 'EQ'` doc wins a shared refId),
  suppresses terminal regression, cleans opposite-prefix orphans.
- `functions/scripts/verify/data-pipeline-st-order-tickets-migration-1003.ts`
  — post-apply parity audit (counterpart existence, refId/origin/state/
  terms/tracking/lineage, mirror-legal suppression tolerance).
- `screenshot-capture/tracking.ts` — nested `tracking.*` on canonical
  tickets with top-level legacy merge; `verify-564` cleans emitted
  `pap_{tradeId}` tickets + `st-screenshots`/Storage artifacts.
- `validateStTicketTerms` — fractional quantity legal for non-option
  instruments; integer required for `option`/`expressionTemplate`.

Acceptance criteria (from #1003): new writes hit both collections during
soak; legacy docs migrate preserving refId/state/lineage with
`status:'paper'`→`mode:'paper'`; readers cut over after verify; legacy
writes stop only at the #1015 FE/rules cutover (not this task).

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, `functions/node_modules` installed.
- ADC (`gcloud auth application-default login`) for prod reads/writes.
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`.
- S6/S7 additionally need a live-run-free window — run when no PDR/ST/nightly
  pipeline is in flight so `--apply` doesn't race an active write.
- S6 also needs `firebase deploy` permission on the rel-str project.

## Scenarios

### S1 — Spec suites

**Confirms:** mapper rejects malformed docs and maps every status/mode/
terms/lineage case; mirror txn terminal-wins, opposite-prefix delete,
orphan cleanup, fail-soft malformed, `updatedAt` non-regression;
`getTicketDoc` pick-chain (migrated doc → non-template order doc →
legacy fall-through when only lifecycle tickets share the refId);
tracking nested+top-level merge; fractional-equity/integer-option
validation.

```
cd functions && npx tsx --test "../tests/functions/order-tickets/**/*.test.ts"
cd functions && npm run test:order-intents-migration
cd .. && npx jest tests/functions/screenshot-capture shared/st-order-tickets.spec.ts --coverage=false
```

**Expected:** 81/81 tsx specs, all jest suites pass.

**Result:** PASS — 81/81 tsx, jest green (screenshot-capture 143/143 +
shared ticket pins; the suite's earlier failure was pre-existing
unrelated screenshot noise, recorded in the review doc).

### S2 — Build + typecheck + paper-trading sweep

**Confirms:** reader/writer/tracking changes compile; the paper callable
path (`getTicketDoc` consumer, fractional-quantity warn, term-guard)
still satisfies all 236 paper-trading specs.

```
cd functions && npx tsc --noEmit -p tsconfig.json && npm run build && npm run test:paper-trading
```

**Expected:** tsc clean, esbuild bundle green, 236/236.

**Result:** PASS — tsc clean, `lib\index.js` ~1.9mb, 236/236.

### S3 — Contract pins

**Confirms:** the canonical-shape verifier passes post-relax —
fractional equity accepted, fractional option/`expressionTemplate`
rejected (the previously stale `1.5`-always-throws pin was updated in
review round 4).

```
npx tsx scripts/verify/data-pipeline-st-types-998.ts
```

**Expected:** all checks pass.

**Result:** PASS — all checks pass.

### S4 — Migration dry-run (prod, read-only)

**Confirms:** the script enumerates the live `order-intents` collection,
maps every doc, and settles paper tickets from the linked equity trade.

```
cd functions && npx tsx scripts/migrate-order-intents-1003.ts
```

**Expected:** ~90 docs, all mappable, 0 malformed/failed,
`paperSettled=9` at last run (rises as new paper intents accrue linked
trades), `orphans=0` until a real mode flip exists.

**Result:** PASS — 90/90 mappable, `paperSettled=9`, 0 malformed/failed
(latest dry-run 2026-10-17).

### S5 — Pre-apply parity audit (prod, read-only)

**Confirms:** the audit executes and correctly reports the pre-migration
state — every mappable legacy doc FAILs "no canonical counterpart".

```
cd functions && npx tsx scripts/verify/data-pipeline-st-order-tickets-migration-1003.ts
```

**Expected (pre-deploy+apply):** exit 1, ~90 FAILs all
`no canonical counterpart` — any other FAIL or WARN here is a real
finding, not noise.

**Result:** PASS — executes cleanly; 90 FAILs all "no canonical
counterpart" (correct pre-apply).

### S6 — Deploy + soak (prod writes — needs operator window)

**Confirms:** `orderIntentsMirror` is live and dual-writing.

Steps (operator):

```
cd functions && firebase deploy --only functions
```

Then verify the mirror live with a self-cleaning probe (the mirror is the
only trigger on `order-intents` — nothing else consumes the collection;
the probe uses `userId:'qa-1058'` so it never appears in the real user's
ticket views):

1. `create savant-trader/data/order-intents/QA-1058-PROBE` with
   `status:'paper'` → expect `st-order-tickets/pap_QA-1058-PROBE`
   (`mode:'paper'`, `migratedFrom:'order-intents'`).
2. Update `status:'submitted'` → expect `liv_QA-1058-PROBE` created and
   `pap_QA-1058-PROBE` deleted (opposite-prefix orphan cleanup).
3. Update `status:'filled'` + `result.fillPrice` → canonical `liv_`
   `filled` with `fillSummary`.
4. Update `status:'cancelled'` → canonical stays `filled`
   (terminal-wins suppression).
5. Delete the probe → both `liv_`/`pap_` candidates gone.
6. Cloud logs: `order_intents_mirror_*` entries per step, no
   `order_intents_mirror_malformed`.

**Expected:** canonical mirror exists per mappable legacy write;
warnings only for genuinely malformed docs.

**Result:** PASS — deployed 2026-10-17 21:24Z (trigger
`orderintentsmirror-245741`, eventarc nam5; first attempt 403'd on the
function SA missing `eventarc.eventReceiver` — granted to
`rel-str-partner-caller-prod`, redeployed clean). Live probe run:
11/11 — `pap_` mirror created on `status:'paper'` with
`mode:'paper'`/`migratedFrom`/`refId` intact → `liv_` on mode flip with
`pap_` orphan deleted → `filled` with `fillSummary{averagePrice:12.34,
filledQty:1,filledAt}` → stays `filled` on a `cancelled` write
(terminal-wins) → both candidates removed on legacy delete. Mirror logs:
invocations per step, zero runtime WARNING/ERROR (the only ERROR entries
are audit logs of the failed deploy attempts pre-grant).

### S7 — Migration `--apply` + parity audit (prod writes)

**Confirms:** the real backfill lands and is idempotent.

Steps (operator, outside live-run windows):

```
cd functions && npx tsx scripts/migrate-order-intents-1003.ts --apply
cd functions && npx tsx scripts/migrate-order-intents-1003.ts          # rerun → all 'unchanged'
cd functions && npx tsx scripts/verify/data-pipeline-st-order-tickets-migration-1003.ts
```

**Expected:** `--apply` writes mapped tickets (created/updated split
depends on mirror coverage since deploy); rerun reports `unchanged=90`;
parity audit exits 0 with 0 FAIL (WARNs allowed for mirror-legal
terminal suppression and `filled` docs that never captured fill data).

**Result:** PASS — `--apply`: `created=90 updated=0 unchanged=0
orphans=0 paperSettled=9 malformed=0 failed=0` (10 expected
`filled`-without-fill-data WARNs + 1 quantity/dollarAmount precedence
WARN on the SCHB doc — both documented fallback classes). Idempotent
rerun: `unchanged=90`, zero creates/updates. Parity audit: `90 legacy /
90 canonical`, `0 FAIL / 0 WARN`, AUDIT PASS.

### S8 — Canonical-first reader + canonical doc spot check (post-apply)

**Confirms:** `getTicketDoc` resolves migrated docs from the canonical
collection and the emitted shape is inspectable.

```
cd functions && npx tsx scripts/verify/data-pipeline-st-order-tickets-1002.ts
```

Plus a console/CLI spot check of 2–3 `st-order-tickets` docs:
`{liv|pap}_` id ↔ `mode`, `origin.type`, `signalContext`, nested
`tracking`, `migratedFrom:'order-intents'` on migrated docs, no
opposite-prefix siblings sharing a `refId`.

**Expected:** shape audit passes on migrated docs; spot-checked docs
match the contract.

**Result:** PASS — `data-pipeline-st-order-tickets-1002.ts`: `90 docs,
0 FAIL / 16 WARN`, all in documented classes (10× migrated `filled`
lacking legacy fill data; 1× live `submitted` without brokerOrderId —
the pending SCHB stop-loss; 4× `filledAt` date-only strings sorting
before ISO `submittedAt` — day-precision trade dates, cosmetic).
Counts: `liv=81 pap=9` (matches `paperSettled=9`), all
`migratedFrom:'order-intents'`, 0 shared `refId`s (no opposite-prefix
orphans). Sampled doc is contract-clean: nested `tracking`,
full `signalContext` (decisionId(s), barDate, timeframe, direction,
signalPrice), `origin{type:'signal',signalId}`, `brokerOrderId`,
`submittedAt`, `accountTarget`, `bucketId`.

### S9 — Screenshot lifecycle on canonical tickets

**Confirms:** `verify-564` end-to-end run works against the canonical
ticket path and cleans up after itself — proves `ledgerDepsWithCapture`
→ `tracking.*` nesting + `carrier.docPath` indexing on
`st-order-tickets`.

```
cd functions && npx tsx scripts/verify/paper-trading-signal-order-564.ts
```

**Expected:** all checks OK; cleanup removes ticket, trades, cohort,
`st-screenshots` index docs, and Storage artifacts.

**Result:** PASS — 16/16 (canonical ticket seeded at
`st-order-tickets/pap_verify-564-ticket`, canonical-first read resolved
it, idempotent retry verified, expression fill pass produced OPEN trades
from real chains/quotes, zero broker-mutation calls, cleanup removed all
verification docs). One documented limitation: the lifecycle capture
fail-softs locally with `Bucket name not specified` — `getStorage().
bucket()` resolves `FIREBASE_CONFIG.storageBucket` only in the deployed
runtime, so the artifact-write leg can't be exercised under local ADC;
confirm on the first real capture post-deploy (fail-soft by design —
the trade/fill path is unaffected).

### S10 — Regression/smoke checklist

| Check | Result |
|---|---|
| `test:st-signals` still passes (signal write path upstream of the mirror) | PASS — 34/34 |
| Auto-paper ingest dual-write still emits `pap_{tradeId}` tickets | covered — #1002 emission wiring unchanged; next nightly ingest confirms organically |
| `cancelPaperTrade` still transitions canonical tickets | covered — 236/236 paper-trading jest incl. cancel specs |
| No new `functions/src` errors in deploy/mirror logs | PASS — zero runtime WARNING/ERROR on `orderIntentsMirror` |

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| New writes hit both collections during soak | S6 (deploy + observe) |
| 77→90 docs migrated preserving refId/state/lineage; `status:'paper'`→`mode:'paper'` | S1 (mapper specs) + S4 (dry-run coverage) + S7 (apply + audit) |
| Readers cut over after verify; legacy writes stop only at #1015 | S8 (canonical-first inspection; legacy fallback retained by design) |
| Migration idempotent + terminal-wins | S1 (suppression specs) + S7 (rerun → unchanged) |
| Opposite-prefix orphan cleanup | S1 + S6/S7 (mirror txn + migrate) |
| Paper settle from linked trades (EQ doc wins shared refId) | S1 + S4 (`paperSettled=9`) + S7 |
| No regressions in adjacent paths | S2 + S9 + S10 |

## Residuals / known limitations (accepted in review)

- Mirror is merge-write only — a legacy `deleteField()` doesn't propagate
  (documented in the trigger header; surfaced by the audit pre-#1013).
- A legacy doc mirrored then later malformed leaves the last-good
  canonical copy (fail-soft by design).
- Audit tracking-leaf equality assumes canonical `tracking.*` doesn't
  outrun legacy — true while the lifecycle detector's tracking writers
  have no production callers; revisit when the detector wires in.
- Cohort siblings can mint multiple EQ trades under one `refId`; settle
  picks deterministically but the set is best-effort.
