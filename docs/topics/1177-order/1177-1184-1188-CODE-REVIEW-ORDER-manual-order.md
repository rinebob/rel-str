**Topic:** Manual Order Entry  
**Topic Slug:** order  
**Thread:** Header Order Ticket  
**Thread Slug:** manual-order-header-order-ticket  
**Issue:** #1188  
**Blueprint:** #1184  
**Thread Parent:** #1178  
**Topic Parent:** #1177  
**Task:** #1188  
**Domain:** ORDER  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

# Code Review — #1188 FE-IMPL: Manual ticket builders + ManualOrderService

Three axes (Standards / Spec / Thermo-Nuclear), all findings remediated in
task scope before this document was written. Verdict: **PASS** — see the
gate section at the bottom.

## Files under review

| File | Change |
|---|---|
| `utils/manual-ticket-staging.util.ts` | NEW — `buildManualEquityTicket`, `buildManualOptionTicket`, `normalizeUnderlyingSymbol` |
| `services/manual-order.service.ts` | NEW — `open()`, `stageEquityTicket()`, shared config cache |
| `components/gallery-ticket-dialog/gallery-ticket-dialog.component.ts` | MOD — `GalleryTicketDialogData` union, `manual` seed, null-ticket manual branch, `onOptionStaged` forwards to manual |
| `utils/option-ticket-staging.util.ts` | MOD — `OCC_SYMBOL_PATTERN` exported and shared (review-driven) |
| `services/trading-config.service.ts` | MOD — `config` cache signal + `warmConfig()`/`ensureConfig()` (canonical home, review-driven) |
| `stores/order-ticket.store.ts` | MOD — `discardIfStaged(id)` (canonical STAGED-guard home, review-driven) |
| `stores/gallery-card-actions.service.ts` | MOD — delegates `config`/`warmConfig`/`ensureConfig`/`discardStagedTicket` to the canonical homes |
| `pages/signal-order/order.component.spec.ts` | MOD — date-bomb fixture fix (pre-existing flake, unrelated to feature) |
| Specs ×5 | manual builders, service, dialog manual mode, store `discardIfStaged`, trading-config snackbar provider |

## Standards axis

Findings (all resolved):

- **Duplicate logic** — `ensureConfig`/`warmConfig` and `discardStagedTicket`
  were verbatim copies of the gallery service's. Extracted to canonical
  homes: `TradingConfigService.config`/`warmConfig`/`ensureConfig`
  (precedent: `EquityPriceService.prices` cached signal) and
  `OrderTicketStore.discardIfStaged`. `GalleryCardActionsService` now
  delegates; its public API is unchanged.
- **`onOptionStaged` never reached the manual seed** — would have orphaned
  manual option tickets on close. Now forwards to
  `data.manual?.onStaged` as well.
- **Dialog data was an option-bag** — `{ tradingConfig }` alone compiled.
  Now `{ tradingConfig } & ({ ticketId; option? } | { manual })` — the
  mutual exclusion is compile-time.
- **Duplicated OCC charset** — the manual builder declared its own copy of
  the signal builder's regex. `OCC_SYMBOL_PATTERN` is exported from
  `option-ticket-staging.util` and shared.
- **Permissive underlying regex** — `^[A-Z0-9.\-]+$` admitted `-`, `..`,
  `-AAPL`. Now `^[A-Z0-9][A-Z0-9.\-]*$` (alphanumeric-led); spec cases
  added.
- **Invalid symbol burned a quote fetch** — `normalizeUnderlyingSymbol`
  exported; the service validates before `fetchPrices` and snackbars
  `${raw}: not a valid ticker` (spec asserts no fetch call).
- **Spec hygiene** — `{ updatedAt }`-only `TradingConfig` mocks replaced
  with `configResult = null` (a doc without `accountNumber` isn't a
  `TradingConfig`); `ManualOrderDialogSeed` used directly instead of
  inline casts; `ManualOrderService` spec mocks `discardIfStaged` with the
  store's guard mirrored.
- **Manual-mode close guard untested** — dialog spec gained a manual-mode
  describe: stays open with no ticket bound; `onOptionStaged` forwards.
- **Unused `OrderTicket` import** — removed.

Accepted-minor (documented, not fixed — scope discipline):

- `open()` shows its own snackbar after `ensureConfig` fails → a transient
  double snackbar on hard load failure. Inherited verbatim from the
  gallery mirror; fixing it means changing `ensureConfig`'s contract for
  every caller — deferred.
- `_staging` busy-key second resolve returns silent `null` — the dialog
  task (#1189) will surface busy/error feedback at the seam.

## Spec axis

All six acceptance criteria verified against the task issue:

| AC | Evidence |
|---|---|
| Manual builders produce `OrderSource.MANUAL`, no `sourceRef`/`signalContext` | util spec asserts both fields absent |
| Equity builder covers account/symbol/side/order-type/sizing/id | `ManualEquityTicketContext` + spec |
| Option builder: one OCC contract, optionId, side, positionEffect, qty | `OPT-MAN-{BTO\|STO}-{occ}` id, spec |
| Validation: uppercase normalize, underlying/OCC charset, `null` contract | exported `normalizeUnderlyingSymbol`; shared `OCC_SYMBOL_PATTERN` |
| `ManualOrderService`: open/stage/adopt/discard, single-flight | 20 service specs incl. collision + re-entry |
| Dialog manual seed, optional `ticketId`, card-mode unchanged | union type + 22 dialog specs (card path untouched) |

Additionally verified during re-verification:

- `order-ticket-st-mapper` maps `MANUAL → origin.type: 'manual'`,
  `auto: false`, no `signalId` mint — manual tickets round-trip the
  canonical ST shape.
- `submitTicket` routes by `instrumentType` only — manual equity/option
  reuse the existing execution paths; no new pipeline.
- `ticketsBySymbol` grouping keys on `ticket.symbol` — builders uppercase.

Spec gaps closed during review:

- Manual-mode close guard when no ticket is staged yet (dialog spec).
- Different-symbol STAGED manual coexistence (service spec).
- Doc-id collision: same-minute non-STAGED twin → bail + snackbar;
  STAGED signal twin → bail (never adopted as manual).

## Thermo-Nuclear axis

Critical finding (fixed): **doc-id collision silently overwrote a live
ticket.** `buildTicketId` resolves to the PT minute and `createTicket` is
a bare `set()` — a same-minute `AAPL-BUY-{ts}PT` ticket in SUBMITTED/
RESTING/STAGED-signal state would have been clobbered by the manual
create, orphaning the live broker order and inviting a double submit.
`stageEquityTicket` now checks `tickets()[ticket.id]` post-build: adopts a
STAGED manual twin, snackbars and bails on anything else.

Also from the nuclear pass: the gallery duplication extraction (above),
the option-bag union (above), the `open()` double-open race — flag claimed
before the config await so concurrent calls can't both open — and the
self-referential `manual.onStaged` replaced with a shared `track` local.

## Cross-cutting regression caught by the gate

`order.component.spec.ts` — "resolves a local CANCEL_PENDING to CANCELLED"
failed deterministically: the fixture hardcoded
`lastTransactionAt: '2026-10-20T18:00:00Z'`, and the queue's 24h
terminal-recency filter now drops rows older than that. A **pre-existing
date-bomb**, unrelated to this task — the test passed when written
(≤24h after Oct 20) and cannot pass again. Fixed by minting
`new Date().toISOString()` at test time; assertion unchanged.

## Test evidence

- Focused: 7 suites / 223 tests — all green (builders 24, service 22,
  dialog 22, gallery actions, order-ticket store, trading-config,
  order component).
- `tsc --noEmit -p tsconfig.app.json` — clean.
- Full Jest suite — see gate section.

## Gate

**PASS**

- All three axes' blocking findings remediated and re-verified.
- The one full-suite failure was a pre-existing date-dependent spec
  unrelated to the feature; fixed as a courtesy to keep the gate honest.
- Follow-ups deferred to their owning tasks: manual equity form (#1189),
  option manual mode + BTO/STO + `review_option_order` preview (#1190),
  header button (#1191), silent-null busy feedback (#1189).

## Round 2 — re-review of the remediation

All three axes re-ran against the remediated code. Round-1 fixes verified;
two new substantive findings emerged (both fixed):

- **MAJOR (nuclear): the collision guard missed hydrated twins.** The
  ticket map is mixed-keyed — session entries are bare-keyed, hydrated
  docs carry the `liv_`/`pap_` doc prefix. `tickets()[ticket.id]` only
  caught same-session twins; a reload would leave `liv_AAPL-BUY-{ts}`
  invisible to the guard → same overwrite hazard. Fixed: probe
  `tickets()[id] ?? tickets()[stDocId(id)]` (stDocId is prefix-aware).
  New spec seeds a `liv_`-keyed SUBMITTED twin.
- **MINOR (nuclear): rehydrate rekey defeated discard-on-close.** The
  same mixed-key issue meant a mid-dialog `loadTickets()` could rekey a
  session-staged bare entry under `liv_`, and `discardIfStaged(bareId)`
  would miss it → a cancelled STAGED ticket leaked into the queue.
  `OrderTicketStore.discardIfStaged` now resolves the key both ways and
  moved into the second `withMethods` block (`store.removeTicket` — no
  `this` fragility under destructuring).

Minors fixed: `ensureConfig` now caches legit nulls via `_loaded`
(saveConfig invalidates); `dialog.open` throw resets `_dialogOpen`; the
two collision specs freeze time via `jest.setSystemTime` (minute-boundary
flake removed); `contract?.occSymbol` null-arg guard; redundant narrowing
cast dropped; `TradingConfigService` cache API gained direct spec
coverage; gallery spec asserts the delegation; `EQUITY`-default +
`#1190` manual-mode close-effect comments added; store header method
list updated; `NO_ACCOUNT_SNACKBAR` const hoisted.

Documented, accepted (not fixed — scope):

- Manual `_staging` and gallery `_busyKeys` are disjoint in-flight guards —
  a same-symbol same-minute stage across the two surfaces can still race
  one Firestore write. STAGED-data clobber only (no broker-order orphan),
  ~one-write window; a shared per-doc-id flight set would close it.
- `open()`'s post-ensureConfig snackbar can double-report on hard load
  failure (inherited codebase-wide).
- `': no price — cannot size ticket'` remains a per-file literal in two
  services (text sync only).

## Round 3 — re-review of round 2

All three axes re-ran. Round-2 fixes verified; new findings:

- **MEDIUM (nuclear F1): stage resolving after dialog close leaked a
  persisted STAGED ticket.** The close pass drains `createdTicketIds`
  before the in-flight `stageEquityTicket` resolves, then `track` pushed
  into a set nobody reads. Fixed: the seed wrapper discards on resolve
  when `!_dialogOpen` (both `stageEquityTicket` and `onStaged` paths).
  Spec added.
- **LOW (nuclear F3): `_dialogOpen` could wedge if `ensureConfig` threw**
  (it can't today — internal catch — but the await was unguarded). Fixed:
  try/catch releases the flag + snackbars. Spec added.
- **LOW (nuclear F4 / standards): `saveConfig` invalidation could be
  re-armed stale** — an in-flight `warmConfig`/`ensureConfig` resolving
  after a save wrote the pre-save doc and re-marked `_loaded`. Fixed:
  `_gen` write-generation token; a load that started before a save never
  commits, and `ensureConfig` refetches instead of serving the stale read.
  Spec added (save → ensureConfig refetches).
- **MINOR (standards): dead `OrderSource` import** in
  order-ticket.store.ts — removed.
- **MINOR (standards): spec mocks didn't mirror the dual-key probe** —
  the exact bug class round 2 fixed in production code. Both
  `discardIfStaged` mocks now resolve `tickets()[id] ? id : stDocId(id)`;
  gallery's `removeTicket` mock mutates the map like the real method.
- **Spec gaps (spec axis):** added coverage for `MatDialog.open` throw,
  overlapping `open()` calls sharing one dialog, `saveConfig` cache
  invalidation, and the `null` option-contract arg.

Deferred beyond task scope (flagged, not fixed):

- **Nuclear F2 — store-level mid-flight rekey hazard.** `loadTickets()`
  wholesale-replaces the map and rekeys bare→`liv_`; methods that captured
  a pre-rekey id (`submitTicket`'s success persist, `stageTicketAndWait`'s
  post-await local set, error restores) can miss or leave dual-keyed
  ghosts if a `refresh()`/page-load lands mid-write. Narrow window
  (requires an async write racing a reload), partially predates this task,
  and the fix belongs inside `OrderTicketStore`'s hydration/merge path —
  not the #1188 builder+service surface. Recommend a dedicated task when
  the dialog-over-gallery interaction (#1191) makes the trigger real.
