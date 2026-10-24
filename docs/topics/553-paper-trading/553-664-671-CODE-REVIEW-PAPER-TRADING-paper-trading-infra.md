**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Thread Slug:** trade-exits  
**Issue:** #664  
**Thread Parent:** #652  
**Topic Parent:** #553  
**Task:** #671  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# Code Review — #671 FE: Dashboard close/cancel actions + confirm + CANCELLED chip

**Verdict: PASS** — two rounds. Round 1 (three parallel axes —
Standards / Spec / Thermo-nuclear): no critical/major findings, ten
minors + spec gaps remediated in-pass. Round 2 (fresh axes on the
remediated final state, real-defects bar): **converged — no new real
defects**; every round-1 fix verified landed. Remaining items are
accepted bounds documented below.

Files under review (uncommitted worktree, scoped diff):

- `src/app/features/savant-trader/pages/paper-trading/paper-trading.component.{ts,html,scss,spec.ts}`
- `src/app/features/savant-trader/stores/paper-trading.store.ts` (+spec) —
  `cancelledTrades` computed only
- `src/app/features/savant-trader/components/paper-trade-action-dialog/`
  (new: component ts/html/scss + spec)

Scope note: service/store plumbing shipped in #670; strategy-builder
governing select is #672 — both out of scope.

## Standards

**Contract baseline — verified.** `MatDialog` is `providedIn: 'root'`
(dialog-module.mjs:670) — no `MatDialogModule` needed on the page,
matching the `allocation-buckets-table` precedent (module providers would
shadow test mocks). `setTradeFilters(ListPaperTradesRequest)` →
`{ status }` matches the shared contract's optional `status?:
PaperTradeStatus`. Mocks mirror real signal shapes
(`actingIds: Signal<ReadonlySet<string>>`, `tradesBy*: Map`).

**Findings → dispositions:**

- **MINOR: dead `MatIconModule` in the dialog — fixed.** No `mat-icon` in
  the template; removed.
- **MINOR: `onStatusFilter` comment overpromised — fixed.** Said "ANDs a
  filter"; `setTradeFilters` replaces `tradeFilters` wholesale — comment
  now says "sets".
- **MINOR: `cancelledTrades` reads dead — kept, justified.** Issue #671
  explicitly requires the selector (review finding: cancelled trades
  vanish from every list). Comment records it as a library selector for
  consuming surfaces (datasets/analysis workbench).
- **MINOR: `latestMark` latent edge — fixed.** Picked the latest *dated*
  entry even when it carried only `underlyingClose`; now scans descending
  for the first defined `mark`.
- **NIT: `openAction` name hid the dialog — fixed** → `openActionDialog`.
- **NIT: store-in-dialog vs presentational sibling — accepted.** The
  `order-confirm-dialog` stays pure in/out, but this dialog's spinner
  must bind `actingIds`; header comment records the deliberate choice.
- **NIT: `cancelledTrades` mock in the page spec — removed** (component
  never reads it).

## Spec

**All criteria met.** Issue ACs ↔ TEST doc "Dashboard component" ↔
IMPL §2/§4 all land: OPEN→close / PENDING→cancel / terminal→none
(ASSIGNED correctly excluded — BE accepts OPEN only); confirm dialog +
spinner; `unavailable`/`failed-precondition` surface via the store's
error signal + snackbar with the row unchanged (#670 store pins);
cohort drill-down rows share the same template loop; CANCELLED chip +
filter entry; `cancelledTrades` selector.

**Coverage gaps remediated in-pass:**

- Terminal statuses beyond CLOSED unasserted → spec now covers
  EXPIRED/ASSIGNED/CANCELLED explicitly.
- CANCELLED filter entry asserted only via `onStatusFilter` → spec now
  opens the real select and reads the rendered `mat-option` overlay.
- `confirmed` gate on the settle-close effect unpinned → new spec:
  opened-while-acting + flag clears without confirm → dialog stays open.
- Dialog-stacking unguarded → `openDialogs` guard (manual-order.service
  precedent) + spec.

Component-level "callable error → visible message, row unchanged" is
covered by composition — the store spec pins `trades()` unchanged +
error signal on failure, the page's error-banner spec pins visibility.
Not duplicated at the page level.

## Thermo-nuclear

RxJS/signal lifecycle verified sound: `runExitAction` flags
`actingTradeIds` synchronously before the dialog's effect re-runs
(effects coalesce), so no premature close; component-scoped effect
can't leak. The sync-flag reliance is now commented as a load-bearing
invariant.

**Findings → dispositions:**

- **MINOR: status→action if/else-if duplicated the domain rule —
  fixed.** `ROW_ACTIONS: Partial<Record<PaperTradeStatus, {...}>>` makes
  "OPEN closes, PENDING cancels, terminal does nothing" explicit data;
  the template collapses to one button. Third action = one line.
- **MINOR: no single-instance dialog guard — fixed** (above).
- **MINOR: `confirmed` gate unpinned — fixed** (above).
- **NIT: result contract lied and was unobserved — fixed.** Dialog
  closed `true` even on failure settle (can't distinguish) and
  `openAction` ignored `afterClosed`; the `<boolean>` typing and
  payloads are gone — `close()` carries no claim.
- **NIT: fragile implicit invariant — documented.** The settle-close
  depends on the store flagging synchronously; comment added.

## Round 2 — re-review of the remediated final state

Fresh axes at a real-defects bar (convergence check, not a nit hunt):

- **All round-1 fixes verified landed** — `ROW_ACTIONS` map correct
  (`Partial` indexing narrows under `@else if … as`), `openDialogs` is
  the real `MatDialog` API, `latestMark` desc-scan, payload-free
  `close()`, `confirmed`-gate spec, terminal-status matrix spec,
  overlay `mat-option` spec, `MatIconModule` removed, sync-flag timing
  re-verified against `runExitAction`.
- **MINOR: `protected readonly PaperTradeStatus` dead after the
  `ROW_ACTIONS` restructure — fixed** (template no longer references it).
- **MINOR: `openDialogs` guard comment overstated parity — fixed.** It
  suppresses while ANY app dialog is open (deliberately conservative),
  not the per-feature flag `manual-order.service` uses — comment
  corrected.
- **NITs fixed:** IMPL as-built said "closes `true`" (payload-free now);
  page `@task` header omitted #671.
- **Accepted:** Dismiss is disabled while `busy()` but backdrop/Esc still
  dismiss — a mid-flight dismissal leaves a no-op `close()` on settle;
  harmless (opener ignores the result).

## Test results

- Focused: **66/66** post-remediation (store + page + dialog specs).
- Paper-trading batch: **125/125** (pre-remediation; focused re-run
  covers the changed files).
- Full suite: **4451/4451 — 259/259 suites green** on the final state.
- `tsc --noEmit -p tsconfig.app.json` — clean.
- `git diff --check` — clean (EOL warnings only).

## Accepted bounds

- `cancelledTrades` has no in-app consumer yet — mandated by the issue
  as a library selector; comment records intent.
- Dialog performs the mutation itself rather than returning a decision
  — deliberate divergence from the sibling's pattern, forced by the
  `actingIds` spinner binding.
- Failure closes the dialog the same as success — the user sees the
  store's snackbar either way; result-free `close()` keeps the contract
  honest.
- `.status-chip` hard-coded rgba tints match the `analysis.component`
  house style (4 existing copies); token migration is out of scope.
