**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1274  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1439  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# Code Review — #1439: Delete Selection Replay run (cascade run + list + results)

## Verdict

**PASS (Round 2)** — fresh axes on the post-remediation diff surfaced
0 critical / 0 major / 3 minor / ~5 nit; every actionable item was fixed
in-cycle (pct-change `cancelLabel` drift, partial-orphan toast overclaim,
untested third `||` leg) and the suite re-verified green. Round 1's
single major — a third consumer of a duplicated generic confirm dialog —
is resolved by canonicalizing `ConfirmDialogComponent` under
`src/app/shared/ds/` (net −2 files, zero stale references).
Thermo-nuclear Round 2 verdict: **APPROVE** — and it confirmed both
Round-1 rejections (prune-loop merge; `(request, deps)` seam) were
correct on merits.

## Round 2 (2026-11-06) — fresh axes on the remediated diff

### Standards

0 critical / 0 major / 2 minor / 3–4 nit.

- **Minor — pct-change `cancelLabel` regression** — the shared dialog
  defaults `cancelLabel` to `'Back'`; the deleted pct-change copy
  defaulted `'Cancel'`. FIXED: call site now passes `cancelLabel:
  'Cancel'` — no consumer regressed (verified payload-by-payload:
  portfolio already used `'Back'`, option-chart passes `'Cancel'`
  explicitly).
- **Minor — `invoker:'public'` + `cors:true`** — verbatim §7 breach but
  byte-identical to the sibling options callables and mitigated by the
  auth guard; routed to #1437.
- Nits: `cdkFocusInitial` inert (carried-over idiom present in both
  deleted copies — kept deliberately; wiring it would auto-focus a
  destructive confirm); toast overclaim on partial-orphan cleanup —
  FIXED (`deletedRun:false` + orphans → "Removed N leftover docs");
  no dialog-open double-click guard (store dedupes on the second
  confirm — accepted); stale generated paths in
  `docs/topics/1024-design-system/ui-element-sites.json` (generator-
  owned manifest, not hand-edited).

### Spec

All four ACs re-verified met; no remediation regressions; the
"Nothing to delete" branch is consistent with the idempotent spec.

### Thermo-nuclear

**APPROVE** — 0 major / 1 minor / 3 nit (+1 observation: sibling
callables remain unauthenticated — already tracked as #1437). The minor
was the same `cancelLabel` drift (fixed). Nits addressed: untyped
`dialog.open` (consistent with all four sibling call sites — repo-wide
typing is a separate cleanup); third `||` leg of the delete gate now
tested.

### Round-2 test results

- BE `delete.test.ts`: **6/6** (added orphaned-results-only case).
- Store spec: **52/52**; run-list spec + option-chart-list spec green
  from the Round-1 run (94/94 aggregate).
- `tsc --noEmit` (app + functions), functions build: clean.

## Change summary

New `optionsReplayDelete` callable: auth-guarded
(`request.auth?.uid → unauthenticated`), validates `runId`, reads run +
list + result docs in parallel, then one `batch.commit()` deletes
`st-options-replay-runs/{runId}`, `st-options-contract-lists/{runId}`
(docId IS the runId, #1430), and every `st-options-analysis-results` doc
with `contractListDocId == runId`. Idempotent — missing pieces count as
deleted. Shared `OptionsReplayDelete{Request,Response}` contracts.
FE: `deleteRun` on the runs service, `deletingRunIds` store flag with the
same snapshot-lag posture as `retryingRuns`, a delete icon on every
run-list row, and a shared-ds confirm dialog in the dashboard that names
the run (`SPY run 2026-11-06 12:02:20 FRI`).

## Round 1 (2026-11-06)

### Standards

0 critical / 0 major / 4 minor / 4 nit.

- **Minor — `invoker:'public'` + `cors:true`** (guidelines §7) — verbatim
  breach but byte-identical to the two sibling options callables;
  mitigated by the new `request.auth` guard. Routed: **#1437 —
  BUG: Options Replay/Analysis callables accept unauthenticated calls**
  removes this posture family-wide.
- **Minor — `productionDeps` unverified** — private wiring exercised by
  no test. Same posture as `prodReplayRetryDeps`/`prodReplayStartDeps`;
  the single-symbol audit script (`options-replay-single-symbol-1430`)
  already detects orphaned list/result docs as WARNs — the production
  verification seam exists.
- **Minor — analysis-worker orphan race undocumented** — FIXED: the
  header now documents both races (replay worker's unconditional list
  write; analysis worker's unconditional result-doc writes).
- **Minor — scope flag** — FALSE POSITIVE: `dse-select` restyling hunks
  in `backtest-run-control`/`options-replay-run-controls` are other
  sessions' dirty-tree changes caught by an over-wide diff sweep; they
  are not part of this change and will not be staged.
- Nits: third copy of the `code()` test helper (convention-consistent;
  a shared test util belongs to a separate cleanup); stale store comment
  (fixed); `runId` containing `/` yields internal not invalid-argument
  (sibling-consistent posture); test-comment wording (accurate —
  rejected, refers to the helper's own default parameter).

### Spec

All four acceptance criteria **met**:

- Callable deletes run + list + all result docs for the runId, returns
  counts — **met** (single batch; `{deletedRun, deletedLists,
  deletedResults}`).
- Unauthenticated → `unauthenticated` — **met** (pinned by test).
- UI confirm → delete → row disappears without refresh — **met** via the
  `watchRuns` realtime listener; `deletingRunIds` holds the button
  disabled until the snapshot drops the doc.
- Unit tests: cascade counts, idempotent re-delete, auth guard — **met**
  (5 BE cases + 7 FE store cases + 3 component cases).

Verified: `stOptionsContractListDocId(runId)` is the identity seam, and
`contractListDocId == runId` is the only writer key for result docs —
the cascade query cannot miss or over-delete. Batch size is bounded by
the exit registry (~8 writes) — no 500-limit concern.

- "Run row / detail card" affordance — row chosen; the spec's "(trash
  icon next to retry)" implies the row (retry exists only there). Met.
- Running-run guard decision — documented: any status may be deleted;
  both orphan races now documented as accepted residuals (invisible in
  UI, surfaced by the audit, cleaned by re-delete).

### Thermo-nuclear

Verdict was CHANGES-REQUESTED → remediated in-cycle:

- **MAJOR — duplicated generic confirm dialog, third consumer added.**
  FIXED: created `src/app/shared/ds/confirm-dialog.component.ts`
  (superset API — optional `title`), migrated all four consumers
  (backtest-dashboard, option-chain-pct-change, option-chart +
  option-chart-list.spec, portfolio-dashboard), deleted both feature
  copies. Net: −2 files, no cross-feature deep imports.
- Minor — merge `retryingRuns`/`deletingRunIds` prune loops. REJECTED:
  the flags have different prune semantics (fingerprint-change vs
  doc-absent); merging couples two independent lifecycles to save ~15
  lines. Explicit parallel structure kept.
- Minor — seam-shape divergence (`(request, deps)` vs sibling
  `(input, deps)`). REJECTED: `(request, deps)` is the gh-lifecycle
  idiom; keeping the auth check inside the handler means the core can
  never execute unguarded — moving it to the wrapper would let any
  future caller bypass auth.
- Minor — `col-failed` header mislabels an every-row delete button.
  FIXED: column renamed to Actions (`col-actions`).
- Nit — redundant `take(1)` after `afterClosed()` — FIXED.

### Round-1 test results

- `tests/functions/options-replay/` (tsx --test): **70/70 pass**
  including 5 new delete cases (auth, validation, full cascade, partial
  state, fully-missing idempotent re-delete).
- Jest touched specs: **94/94 pass** — store (52, incl. 7 new deleteRun
  cases), run-list (19, incl. 3 new delete-action cases),
  option-chart-list (23 — its `dialog.open(ConfirmDialogComponent)`
  assertion holds against the shared class).
- `tsc --noEmit` (app + functions), `npm run build` (functions): clean.
- Deployment gate: `firebase deploy --only functions` required before
  the button works live — ship step.

## Deployment-only prerequisites

- `optionsReplayDelete` must be deployed (`firebase deploy --only
  functions`) before the row action works against prod.
