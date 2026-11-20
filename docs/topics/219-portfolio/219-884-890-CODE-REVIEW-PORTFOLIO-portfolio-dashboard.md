**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Update Stop Loss  
**Thread Slug:** update-stop-loss  
**Issue:** #884  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Task:** #890  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-19  

# Code Review — #890 Audit Stops (peak-exposure batch tighten)

## Review Round 2 — 2026-11-19 (post-pivot + UI polish re-review)

**Verdict: PASS** — three parallel axes (Spec / Standards /
Thermo-Nuclear), zero critical, zero major. Twelve minors remediated
in-gate and pinned by specs; second pass clean.

Scope: the post-pivot working tree — audit-math util, batch service,
Audit Stops dialog, dashboard wiring (`peaksPending`, toolbar, `?pad=N`
aid), four table scroll-structure fixes, `ds-dialog` scroll strategy +
`panelClass`, `styles.scss` scrollblock override.

### Passes

```text
First pass complete — ~20 findings: 0 critical / 0 major / ~12 minor /
~10 nit. Spec: 9/9 confirmed semantics MET; stale PRD/IMPL/TEST docs +
peaks-pending vacuous audit as the substantive items. Thermo-nuclear:
ds-dialog noop() global blast radius, givebackPct unclamped, canRetry
dead-path trap, pad rows exposing live actions. Standards: vestigial
currentPrice (dropped above-market check), --dse-* token typos,
misleading "within giveback" copy, service-header misattribution.
Second pass complete — three remediation-internal regressions caught
and fixed (two spec fixtures invalidated by skip-above-market, canRetry
× PLACEMENT_DEAD contract collision, panelClass typing); peaksPending
gate verified against composePeaks' always-emits-per-symbol contract.
Convergence: PASS — remaining items are documented deferrals, not
findings.
```

### Remediated in-gate

- **`skip-above-market` disposition** (`portfolio-pnl.util.ts`) — the
  proposed floor `peak × (1 − g)` can sit ≥ current mark when the stock
  blew through its giveback; a sell-stop there triggers immediately on
  placement. Such rows now skip with an "above market" label for a
  manual decision. This also gives the previously-vestigial
  `currentPrice` contract its intended job.
- **`givebackPct` clamped** (`≥0`) — a negative giveback would floor
  above the peak; non-finite peaks now read `skip-no-peak` (was
  mislabeled `skip-no-price`), with symmetric `isFinite` on exposure.
- **`ds-dialog` scroll strategy reverted to `block()`** + global
  `html.cdk-global-scrollblock { overflow-y: hidden !important }` in
  `styles.scss` — keeps scroll-lock semantics for every dialog while
  removing the dead scrollbar track that motivated the noop().
- **`panelClass` string-spread fixed** (`ds-dialog.ts`) — pre-existing
  bug: `panelClass: 'backtest-report-dialog'` was spreading into
  characters and never landing on the pane.
- **`peaksPending` gate** — the dashboard now flags when any covered
  symbol's peak is still deriving (per-symbol contract verified against
  `composePeaks` always-emitting every walked symbol); the dialog gates
  Audit and shows "still deriving" instead of an all-`skip-no-peak`
  audit under a "within giveback" banner.
- **Progress line reads `currentSymbol`** ("Updating AAPL…") instead of
  a raw index that counted skipped rows and read "0" during retries;
  `retryOne` now points `currentIndex` at the retried row.
- **Results summary is honest** — "N tightened · M failed · K not
  attempted" replaces a bare "Run aborted" that hid partial ratchets.
- **`canRetry` / dead paths** — the no-computed-ticket patch carries a
  non-retryable result; `rePlace` with no retained ticket settles
  failed instead of wedging 'running'; place-phase retry additionally
  requires a retained ticket.
- **Pad-row safety** — the `?pad=N` aid's synthetic rows no longer
  render Close/Add Stop broker actions.
- **Copy/tokens/nits** — `--dse-warn/--dse-error` typos → real
  `--ds-warning/--ds-error` tokens; service header rewritten to audit
  vocabulary + correct qty attribution; "Nothing to tighten" copy now
  counts skipped rows; input `min` aligned to validation; `!` assertion
  removed; `svc.reset()` on new preview clears stale session state.
- **Specs** — sequential-run test now asserts real serialization
  (in-flight counter = 1, not just call order); new specs pin
  skip-above-market, negative-giveback clamp, non-finite peak,
  peaksPending gating, above-market label, skip-aware copy, retry
  progress symbol, `reset()`, no-ticket canRetry, dashboard
  peaksPending propagation.

### Deferred / documented (non-blocking)

- PRD/IMPL/TEST docs retain pre-pivot "trail-%" vocabulary — stale
  bookkeeping; issue #890 AC text likewise. The pivot comment on #890 +
  this doc + the UAT doc carry the confirmed semantics.
- **Single-stop dialog uses full position qty** for replacement
  tickets — a same-symbol ladder can oversell on trigger; the batch
  deliberately uses the order's own qty. Divergence flagged for a
  possible follow-up on the #888 path.
- `refId` idempotency reliance in place-phase re-place — inherited
  from the reviewed #887 primitive contract, unchanged here.
- File sizes: `portfolio-pnl.util.ts` (~350) and
  `update-all-stops.service.ts` (~340) sit over the 300-line guideline;
  a `portfolio-stops.util.ts` split is a reasonable follow-up.
- `?pad=N` test aid — kept for now pending the user's keep/strip
  decision before ship; now action-guarded.
- New specs follow file-local `jasmine.createSpy` convention in
  `portfolio-dashboard.component.spec.ts` rather than `jest.fn()` —
  consistent with the file, flagged vs AGENTS.md preference.

### Test results

Full suite green: 324 suites / 6116 tests (`npx jest --coverage=false`).
Portfolio scope after remediation: 37 suites / 734 tests (+10 new).
`tsc --noEmit -p tsconfig.app.json` clean.

---



**Verdict: PASS** (three parallel axes — Spec / Standards /
Thermo-Nuclear — one critical + six majors remediated in-cycle and
pinned by specs; second pass clean)

> **Post-review pivot (2026-11-18):** after this review passed, UAT
> surfaced that the intended semantic was an *audit* — "is any stop
> exposed beyond x% of its position's peak since entry?" — not a
> mark-based trail repricer. The candidate math, dialog copy, and
> dashboard wiring were pivoted: the audit anchor is
> `PositionPeak.lifetime` (highest day-bar high since entry), exposure =
> `(peak − stop) / peak`, and the proposed floor is `peak × (1 −
> giveback)` — so "exposed" and "needs tightening" are the same test and
> tighten-only is structurally guaranteed. The service's execution
> machinery (sequential updates, abort, phase-aware retry, ticket
> semantics, quantity/marketHours pinning) is unchanged and its review
> findings still stand; the candidate utility was rewritten and
> re-pinned by 10 new specs (exposure, boundary, cent-precision,
> lifetime-vs-sinceLastFill anchoring, no-peak, ladder, gate parity).
> The review findings below were remediated against the pre-pivot code
> but every fix carries through — the retry/abort/quantity/marketHours
> surfaces it covered were not touched by the pivot.

## Change summary

A preview-gated batch ratchet for protective equity stops:

- **`computeStopUpdateCandidates`** (`portfolio-pnl.util.ts`) — one row
  per updatable stop, gated by the SAME `updatableStopsBySymbol` /
  `isUpdatableStopOrder` predicate the per-row Update Stop uses (single
  gate — refactored in-cycle to reuse the map rather than duplicate the
  predicate). Post-pivot: audits each stop against
  `PositionPeak.lifetime` — `computed = peak × (1 − giveback/100)` at
  cent precision; `'update'` only when the floor tightens the resting
  stop — stops never loosen.
- **`UpdateAllStopsService`** (root-provided) — sequential orchestrator:
  `buildStopLossUpdateTicket` (GTC always per IMPL; `marketHours` pinned
  `regular_hours` per #886; the ORDER's own whole-share quantity —
  like-for-like replacement) through `updateEquityStopOrder`
  (cancel → confirm → bounded place). First failure aborts the run,
  remaining rows `'not-run'`; per-row `retryOne` is phase-aware.
- **`UpdateAllStopsDialogComponent`** — trail-% input (validated) →
  per-order preview (current → computed, disposition) → live run/summary
  rendering the service's signals with per-order Retry on rows
  `svc.canRetry` allows. `disableClose` once running; `close(true)` only
  when a broker attempt ran → dashboard silent orders reconcile.
- **Dashboard wiring** — `hasUpdatableStops` computed + Update All Stops
  button in the Equities tab panel toolbar: `agenticAllowed`-gated,
  disabled when no updatable stops.

## Findings and remediation (in-cycle)

### Critical — `retryOne` violated the primitive's phase contract

Both Standards and Thermo-Nuclear converged: the first pass re-ran
`updateEquityStopOrder` (cancel → place) for EVERY failure. Per the
primitive contract (`order-execution.service.ts` + the sibling
stop-loss dialog's `onRetry`):

- `phase: 'cancel'` → old order may still rest → re-run the whole
  primitive (retryable cancels only).
- `phase: 'place'` + `unprotected: true` → old order is gone → re-place
  the RETAINED ticket via `submitEquityOrder`; re-cancelling can never
  succeed and chases a phantom order.
- `phase: 'place'` + `unprotected: false` → replacement likely
  registered → NOT retryable; reconcile instead of risking a duplicate.
- `PLACEMENT_DEAD` → mint a fresh `refId` (the dead placement likely
  consumed the original).

**Fix:** `retryOne` is phase-aware — `not-run`/cancel-phase rows re-run
`runPrimitive` on the retained ticket; place+unprotected rows go through
`rePlace` (retained ticket → `submitEquityOrder`, fresh refId for
`PLACEMENT_DEAD`, `asUpdatePlaceFailure` classifies the bare
`ExecutionResult`); place+!unprotected rows return `false` from
`canRetry` so the UI never offers the path. Pinned by service specs
(15 specs covering the full phase matrix).

### Major — same-symbol ladder oversell

Every ticket carried the FULL position quantity; two resting stops on
one symbol → 2× position on trigger. **Fix:** tickets carry the ORDER's
own whole-share quantity (the positions-table dialog's semantic).

### Major — unvalidated `trailPct`

A cleared number input emits `null`; unguarded, `mark × 1` places a
stop AT market → immediate fill. **Fix:** `trailPctValid` (finite,
`0 < p ≤ 90`) gates Preview; `onPreview` no-ops on invalid.

### Major — Done enabled mid-retry / reconcile race

`retryOne` didn't set `status: 'running'` → the summary's Done button
stayed enabled while a broker call was in flight and `close(true)`
could reconcile against a half-placed state. **Fix:** `retryOne` sets
`running` for the flight and restores `done`/`aborted` honestly in
`finally` (`done` only when every row settled); Done is disabled
whenever `status === 'running'`.

### Major — `run()` exception-unsafe

A synchronous ticket-build throw before the broker `try` stranded the
root singleton at `running` forever. **Fix:** the whole per-order
operation is wrapped; a build throw settles the row `'failed'`
(non-retryable — deterministic, not broker ambiguity) and aborts
cleanly. A second self-found residual — a thrown `ensureTicket` left
the row stuck `'pending'` — was closed the same way.

### Major — zero-whole-share preflight aborted the batch

A fractional-share stop (e.g. quantity 0.4) is a deterministic
pre-flight condition, not broker ambiguity — yet it `failed` and
aborted the whole run. **Fix:** zero-whole-share rows are marked
`'skipped'` up front with an explanatory error; the run continues.

### Minor — assorted

- `marketHours` pass-through could forward `extended_hours` →
  guaranteed RH 400 (#886). Pinned `regular_hours` — every live stop
  necessarily carries it already.
- `dse-spin` keyframes don't exist (real: `spin`) — corrected.
- Dead `DecimalPipe` import — removed.
- `computedStopPrice ?? 0` masked the no-price invariant — explicit
  guard settles the row `'failed'` instead.
- Retry on a stale outcome snapshot could fire a broker call whose
  patch no-ops — `retryOne` re-locates the LIVE row by candidate.
- Preview/results label logic duplicated — unified into
  `dispositionLabel`/`outcomeLabel`.
- Dialog spec mocked the service — added the TEST-doc seam: real
  `UpdateAllStopsService` + mocked `OrderExecutionService`, driving a
  real `updateEquityStopOrder` call end-to-end (macrotask flush per
  AGENTS.md — `fakeAsync` can't drain native awaits).

### Design deviation (recorded, unchanged)

IMPL says abort on *unrecoverable* failure; the implementation aborts
on ANY failure — every failure carries per-order broker ambiguity (a
cancel may have landed while its confirmation was lost), so continuing
compounds divergence on a flaky session. Per-order `retryOne` is the
manual path. Flagged for QA; can be loosened to skip-and-continue on
retryable failures if acceptance prefers.

## Test results

- `portfolio-pnl.util.spec.ts` — 71 pass (8 new candidate specs)
- `update-all-stops.service.spec.ts` — 15 pass (sequence, ticket shape,
  abort, full phase-retry matrix, fresh-refId, zero-share skip,
  exception safety, stale-row guard)
- `update-all-stops-dialog.component.spec.ts` — 11 pass (steps,
  validation, live signals, retry, close semantics, real-service seam)
- `portfolio-dashboard.component.spec.ts` — 59 pass (8 wiring specs)
- Full `src/app/features/portfolio-dashboard` — 37 suites / 721 tests
  green; `tsc --noEmit` clean.
- Repo-wide suite: 2 failing suites (`scanner.component*.spec.ts`) are
  another session's uncommitted scanner WIP (`symbolListsLoading` mock
  not yet updated) — unrelated to this diff.
