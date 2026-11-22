**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** strat-manage-page-overhaul  
**Issue:** #1660  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1549  
**Domain:** STRAT-MANAGE  
**Type:** AS-BUILT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# As-Built — OpsStrat Manage Page Overhaul

## What shipped

The options-strategy lifecycle `Template → Named Variant → Strategy
Instance (variant × symbol) → start/stop live run` is implemented
end-to-end against `st-strategy-*` collections, with the legacy
strategy-builder page replaced by `options/strategy/manage`.

### SHARED (Blueprint #1535)

- **#1538 — Manage instance + variant contracts.** `ManageInstance`
  (id, `variantRef` + embedded `variant`, symbol, mode, trigger,
  stopType, runState, userId, `paperAccountId?`, `lastFiredAt?`,
  ISO timestamps, `deletedAt?` soft delete), request/response
  contracts for the manage callables, run-state and position-status
  enums, instance-validity helpers.
- **#1541 — Variant catalog module.** `MANAGE_VARIANTS` catalog +
  typed `VariantLeg`/`ManageVariant` shapes consumed by both the
  instance-id generator and the FE pickers.
- **#1542 — Manage instance ID generator.** Deterministic
  `{SYM}-{SHAPE}-{DTE}-{legs}-ALL` ids (e.g.
  `QQQ-PCS-45-10-20-ALL`) — duplicate variant×symbol pairs are
  impossible by construction; `@manage/instance-id` alias registered
  in tsc + jest.

### BE (Blueprint #1536)

- **#1539 — Manage instance reader + open pass.** `st-strategy-instances`
  reader, open-gate decoupling (daily triggers open at the noon PT
  routine; signal triggers open on ST signals at noon PT), shared
  option-chain fetchers, observational-'none' seeding.
- **#1543 — Contract-list writer.** `{instanceId}` docs written on
  position open — the id the backtest-analysis page consumes.
- **#1544 — Exit-scan pass.** Position-grain exit matrix over marks;
  configured exits applied through the existing calculation engine.
- **#1545 — Manual open-pass callable.** `manageOpenPassManual`
  ({instanceId}) runs the real open pass on demand — used to seed
  live UAT data.

### FE (Blueprint #1537)

- **#1540 — Route/nav + store + table shell.** `AppRoutes.STRATEGY_MANAGE`,
  `StrategyManageStore` (SignalStore, paper/real mode partition),
  bounded page scroller (table-only scroll contract).
- **#1546 — Instance table.** Full column set, sort + text/run-state/
  position filters, position-status join (Yes·Open / Waiting / No),
  per-row Start/Stop toggling `runState` (UNSTARTED↔ACTIVE; stop
  restarts the same instance — never a duplicate).
- **#1547 — Create New Instance dialog.** Variant × symbols ×
  mode/trigger/stop; one instance per selected symbol; live id
  preview; single `runTransaction` create (all `txn.get`s before
  `txn.set`s — TOCTOU-safe, existing ids incl. soft-deleted land in
  `skipped`); paper-only `paperAccountId` stamp.
- **#1548 — Create New Strategy dialog + Export JSON.**
  Template-driven leg form, ephemeral session variants, JSON export.
- **#1549 — Results summary popup + analysis link.** Per-row Results
  opens `ManageResultsDialogComponent` — stats block (realized /
  unrealized / premium / open / closed / max drawdown, `—` on absent
  fields), open-position rows (symbol/status/legs/premium/uP&L),
  ≥2-point equity sparkline, Analysis action → new tab at
  `AppRoutes.STRATEGY_BACKTEST_ANALYSIS` (`{instanceId}` is the
  contract-list doc id the analysis page queries).

## Architecture decisions

- **Stats + positions come from existing callables — no new BE.** The
  plan's `getStrategyEquityCurve` callable had already been retired
  during the paper-trading stats-doc cleanup; the dialog calls
  `getPaperStats({ scope: statsScopeInstance(id) })` (`inst-{id}`) and
  `listStrategyPositions({ instanceId })`. The equity curve is an
  optional field on the stats doc populated by the nightly recompute.
- **Increment-minted stats docs are first-class.** Position-open
  increments create stats docs carrying only scalar counters —
  `equityCurve`, and initially some P&L fields, are absent until the
  nightly recompute. The dialog therefore treats every stat as
  optional: finite-safe `fmt` (`—` fallback), sparkline omitted below
  two usable points, explicit `statsLoaded`/`positionsLoaded` flags so
  a pending callable never flashes "No results yet".
- **Instance ids are the analysis link's contract.** No id mapping —
  the row's `instance.id` IS the contract-list document id the
  analysis route resolves.
- **Paper v1.** Real-mode rows render with disabled run controls and
  honest empty results; real trading is future work.

## Deviations from plan/spec

- **#1547 partial-create AC superseded:** Create is enabled with ≥1
  clean preview row and writes exactly the clean subset (flagged rows
  stay in the field with a `Created N — M left` notice) — replacing
  the original all-or-nothing AC, per QA feedback.
- **#1548 variant-catalog expansion beyond plan:** 6 templates ×
  40-variant Δ×DTE grid + optional bands + direction/uniformDte —
  larger than the sketched catalog, still additive.
- **#1549 callable substitution** (documented above): equity data via
  `getPaperStats` scope, not a dedicated callable.
- **Review-cycle remediations** (all in-gate, verified by second
  pass): finite-safe stat formatting, loading vs empty-state
  separation, canonical `statsScopeInstance` builder,
  `AppRoutes` route constant + `encodeURIComponent`, NaN-point
  filtering, `data.instance` guards.

## Known limitations

- `SCOPE_RE` rejects dotted symbols (`inst-BRK.B-…`) — pre-existing
  backend constraint; the results dialog is its first manage-id
  consumer. Dotted-symbol strategies can't show stats until the
  backend scope regex widens.
- Sparklines don't appear until a stats doc has ≥2 `equityCurve`
  points — i.e., after the nightly recompute has run over the
  instance. Verified data-driven on live docs, not a render defect.
- `paperAccountId: buildAccountId(uid)` assumes the single-user paper
  account; multi-account paper is out of scope for v1.

## Verification

- Per-task gates: every task passed 3-axis code review (findings
  remediated in-gate) + task QA issue with user-executed UAT.
- Final suite state at ship: 132/132 strategy-manage specs,
  6,183/6,183 full suite, tsc clean.
- Live UAT (QA #1660): populated stats + position row on
  `QQQ-PCS-45-10-20-ALL` (premium 517.00, open 1), empty states on
  UNSTARTED rows, offline error states, analysis new-tab with manage
  state preserved.
