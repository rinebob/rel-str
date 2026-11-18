**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1537  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1547  
**Domain:** STRAT-MANAGE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# Code Review — #1547 FE: Create New Instance dialog (variant × symbols × mode/trigger/stop)

## Verdict: **PASS**

Three axes (Standards / Spec / Thermo-nuclear) ran in parallel on the
working-tree diff, followed by two serial passes. All four ACs met at
spec level on the first read, but the axes surfaced two majors — a
TOCTOU clobber window in the check-then-`writeBatch` create, and a
latent session-variant id-collision crash — both fixed in-cycle along
with ten minors/nits; the second pass caught two more (dialog lock on
rejection, doc count drift). Post-fix: 4 touched suites 86/86 green,
full savant-trader suite 172/172 — 3456 tests. Build clean
(pre-existing `papaparse` CJS warning only); DS verifier 103/103.

## Axis summaries

**Standards — PASS-WITH-FIXES.** `runTransaction` is established prior
art (`spread-list.service`, `position-attribution.service`,
`allocation-bucket.service`); the rewrite matches that shape verbatim
(reads via `txn.get` first, then `txn.set`). Dialog convention fidelity
to `allocation-bucket-dialog` verified — `dse-field`/`dse-select`,
`dialog-error`, `ds-btn` actions, dialog owns the write.
`[(ngModel)]` on writable signals is valid Angular (signal-aware
two-way binding) and required here — `previews`/`canCreate` are
computeds over those signals. Firestore rules
(`request.resource.data.userId == auth.uid` on create) satisfied —
payload stamps `userId: uid`. No criticals after fixes.

**Spec — all four ACs MET.**
AC1 variant-merge + per-symbol fan-out: met (`variants` computed,
`symbols` parse, one input per preview row — free-text field rather
than a token picker, noted as a judgment call, functionally complete).
AC2 paper-default/real-disabled + real-needs-non-ALL: met, triple-
guarded (disabled option, store refusal, service invariant). AC3
daily|signal + ALL-CAPS preview + dup block: met at both layers
(preview flags stream-visible ids; transaction-level `txn.get` blocks
live AND soft-deleted collisions the stream can't see). AC4
`runState:'UNSTARTED'` via Firestore SDK: met — `txn.set` per input,
atomic commit. The test-plan E2E line ("two …-ALL rows appear on the
Paper tab") has no E2E harness in the repo — every step is unit-
covered; the journey itself is deferred to QA as before.

**Thermo-nuclear — 2 majors found and fixed** (below); minors either
fixed or documented. Verified correct: invariant before reads (fail-
fast), transaction atomicity (partial sets impossible), two-layer
dedup, `previews()` recompute cost trivial, `pending()` double-submit
guard, auth drop handled at `requireUserId`, real-mode triple-guard.

## Findings fixed in-cycle

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | major | `getDoc`-then-`batch.set` check was not atomic — a doc created between the last sequential `getDoc` and `commit` was silently full-overwritten (wipes `runState`, `lastFiredAt` → engine re-opens a position, `deletedAt` → zombie resurrection). Realistic for two tabs + future BE create | `createInstances` rewritten as one `runTransaction` — all `txn.get`s first (parallel), then all `txn.set`s; Firestore retries on contention so check+create is atomic (service.spec rewritten to the txn seam) |
| 2 | major (latent) | `addSessionVariant` appended blindly — a session variant id colliding with a catalog id would crash the dialog (NG0955 dup `track` key) and silently substitute the catalog variant via `.find()` | `variants` computed drops catalog-colliding session ids (catalog wins); `addSessionVariant` replaces a same-id push; both spec'd |
| 3 | minor | Dialog failures wrote `store.error` → leaked onto the page banner behind the overlay and persisted after cancel | `store.createInstances` now returns `string \| null`; dialog-scoped errors stay in the dialog |
| 4 | minor | No symbol cap — >500 inputs exceeds the write limit and stalls N sequential reads | `MAX_CREATE_SYMBOLS = 50` + `symbolsError` computed + inline error + `canCreate` gate |
| 5 | minor | Intra-batch duplicate ids unchecked — two inputs with the same id passed the existence check and the second `set` won | `seen` Set rejects `duplicate instance id` before the transaction; spec'd |
| 6 | minor | Escape/backdrop dismissed the dialog mid-write — a "canceled" create still committed | `ref.disableClose = true` while `pending()`; spec'd |
| 7 | minor | `paperAccountId` stamped unconditionally — contract scopes it to `mode='paper'` ("required when mode='paper'") | Gated on `input.mode === 'paper'`; real-mode payload spec'd to omit it |
| 8 | minor | `variantRef` adhoc detection used `sessionVariants().includes(variant)` reference equality — a re-instantiated session variant would stamp its own id | `MANAGE_VARIANTS.includes(variant)` — catalog membership decides, robust to re-instantiation and id collisions |
| 9 | minor | Soft-deleted same-id collision showed a generic "already exists" while the row is filtered from the table — user at a dead end | Error gains `(soft-deleted)` suffix; spec'd. Restore affordance remains a delete-feature spec question |
| 10 | minor | `stopType` stayed `'ALL'` if mode ever flips to real — blank select + every preview row errors | `effect` resets `stopType` to the first valid option on mode change; spec'd |
| 11 | nit | Store spec's `@angular/fire/firestore` mock stale (`getDoc`/`writeBatch`/`runTransaction` missing) — would silently break if the service seam is ever exercised | Mock mirrors the service's import surface (all three specs trimmed to consumed exports) |
| 12 | nit | `@task #1547` missing from accumulated headers on service/store/page | Added; `ReturnType<typeof doc>` → `DocumentReference`; `createInstances([])` early return; specs added for CUSTOM-sentinel preview, mixed-existence abort, txn failure propagation, symbol dedup, no-submit guards |

## Waived / deferred (documented)

- **Global ID namespace** — `st-strategy-instances/{id}` ids carry no
  `userId`; user B minting the same variant+symbol+stop as user A hits
  "already exists" on a doc they can't see or restart. This is the
  SHARED contract's ID grammar faithfully implemented — flag for the
  Topic owner: either intended (one live instance per shape across
  users) or a per-user namespacing change needed at contract level.
- **"Multi-symbol picker" is free text** — comma/space parse with
  normalization/dedup/charset validation satisfies "one instance per
  symbol"; a token/chip control is a UX upgrade if UAT wants it.
- **Soft-deleted same-id dead-end** — preview green → create red → no
  restore affordance because deleted rows are filtered. Better message
  shipped; a restore path belongs to the (unspecced) delete feature.
- **`SYMBOL_PATTERN` duplicates the generator's charset** — divergence
  fails safe (generator throws → preview error); exporting the shared
  constant is contract churn for one regex. Noted.
- **E2E test-plan line** — no E2E harness in the repo; unit seams pin
  every step; the live journey is the QA pass (now possible — the
  dialog mints real docs, unblocking deferred #1598 too).
- **`(collectionData as any).mockData` / `Record<string, any>`
  overrides** — pre-existing spec plumbing style; non-blocking.
- **Dialog opens before `load()` resolves** — preview dedup can miss
  existing ids briefly; the transaction-level check is the real gate.
- **Real mode has no explicit v1 guard in the service** — the store is
  the only caller and refuses real inputs; a direct call with
  `real`+`'T8'` would write a valid-shape doc. Accepted: the invariant
  (`isValidModeStopType`) is the service contract; v1-ness is a UI
  policy that will lift in v2 anyway.

## Second pass

Serial re-check over the final diff — every axis finding accounted for
(fix or documented waive), every #1547 hunk re-read (foreign-session
files in the mixed tree excluded), and every error path traced to a
spec (auth, mode/stop invariant, intra-set dup, exists, soft-deleted
exists, txn failure, empty set, real-mode refusal, canCreate/pending
guards, over-cap). Two new findings surfaced, both fixed:

| # | Severity | Finding | Fix |
|---|---|---|---|
| 13 | minor | `create()` had no `try/finally` — a rejection from `store.createInstances` (impossible today, but the seam is typed `Promise`) would leave `pending` + `disableClose` stuck → permanently locked dialog | `try/finally` restores `pending`/`disableClose` |
| 14 | nit | IMPL as-built spec counts drifted after the in-cycle additions ("(20)/(24)" vs actual 21/23) | Corrected to service 21, store 23, dialog 16, page 26 |

Coverage notes: `runTransaction` retry semantics verified against the
codebase prior art (`spread-list.service` — same reads-then-writes
shape); `Promise.all(txn.get)` is legal inside a transaction (reads
may be parallel; all reads precede all writes); `txn.set` payloads
built outside the txn are fine (Firestore serializes at commit);
`store.variants()` spreading `MANAGE_VARIANTS` preserves object
references, so the dialog's `MANAGE_VARIANTS.includes(variant)`
catalog-membership check is sound.

## Third pass (required — pass 2 was not clean)

Pass 2's delta is 4 lines (`try/finally`) plus IMPL doc text —
re-verified: the disableClose spec exercises the locked→unlocked path
and stays green; no other surface touched. Clean. No fourth pass
warranted.

## Post-fix verification

4 touched suites 86/86 (service 21, store 23, dialog 16, page 26);
full feature suite 172/172 — 3456 tests. `strategy-manage.service`
100% line coverage; dialog 97%. Build clean (pre-existing `papaparse`
CJS warning only); DS verifier 103/103.
