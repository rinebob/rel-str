**Topic:** Manual Order Entry  
**Topic Slug:** order  
**Thread:** Header Order Ticket  
**Thread Slug:** manual-order-header-order-ticket  
**Issue:** #1192  
**Thread Parent:** #1178  
**Topic Parent:** #1177  
**Task:** #1188  
**Domain:** ORDER  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

# UAT — #1188 FE-IMPL: Manual ticket builders + ManualOrderService

## Scope

Task #1188 delivers the manual-order *foundation* only: two pure ticket
builders (`buildManualEquityTicket`, `buildManualOptionTicket`) and
`ManualOrderService` (`open()`, `stageEquityTicket()`, discard-on-close),
plus the shared plumbing they required (`TradingConfigService` config
cache, `OrderTicketStore.discardIfStaged`, `GalleryTicketDialogData`
union). The dialog UI (#1189), option manual mode (#1190) and the header
button (#1191) are later tasks and are **out of scope** here.

## Prerequisites

- Repo checkout at the #1188 code state (no commit required — worktree).
- Node/npm installed; `npm ci` already run.
- No Firebase/emulator/Robinhood access needed for S1–S9: all scenarios
  run against Jest mocks (per repo spec conventions).
- For S10 (manual devtools check): a logged-in dev session of the app.

## How to execute

From the repo root:

```powershell
npx tsc --noEmit -p tsconfig.app.json
npx jest --coverage=false src/app/features/savant-trader/utils/manual-ticket-staging.util.spec.ts src/app/features/savant-trader/services/manual-order.service.spec.ts src/app/features/savant-trader/services/trading-config.service.spec.ts src/app/features/savant-trader/stores/order-ticket.store.spec.ts src/app/features/savant-trader/stores/gallery-card-actions.service.spec.ts src/app/features/savant-trader/components/gallery-ticket-dialog/gallery-ticket-dialog.component.spec.ts
npx jest --coverage=false
```

## Scenarios

| # | Scenario | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| S1 | Equity builder contract | `manual-ticket-staging.util.spec.ts` — "emits a STAGED buy market ticket with MANUAL source and no provenance", id/case/charset cases | STAGED buy market gfd/regular_hours MANUAL ticket, `{SYM}-BUY-{ts}PT` id, null on bad symbols | PASS | jest suite green |
| S2 | Option builder BTO/STO | same spec — BTO/STO/discriminator/OCC/null-contract cases | single leg, `positionEffect:'open'`, qty '1', `OPT-MAN-{BTO\|STO}-{occ}` ids, null on bad OCC/null contract | PASS | jest suite green |
| S3 | `open()` config bail + slot lifecycle | `manual-order.service.spec.ts` `open()` describe (7 tests) | snackbar + no dialog when unconfigured; slot claimed pre-await; released on no-config / `dialog.open` throw / `ensureConfig` throw / `afterClosed` | PASS | jest suite green |
| S4 | `stageEquityTicket` stage + adopt | service spec `stageEquityTicket()` describe | fresh stage persists via `stageTicketAndWait`; pre-existing STAGED manual ticket adopted (`created:false`); signal/option tickets NOT adopted; different symbols coexist | PASS | jest suite green |
| S5 | Same-minute id collision guard | service spec collision tests (incl. `liv_`-prefixed hydrated twin) | STAGED-manual twin adopted; SUBMITTED/signal twin → bail + snackbar, no overwrite | PASS | jest suite green |
| S6 | Discard-on-close | service spec + store spec `discardIfStaged` tests (incl. `liv_` rekeyed entry) | only session-created still-STAGED ids removed; adopted/submitted survive; bare id resolves a `liv_`-rekeyed entry | PASS | jest suite green |
| S7 | Shared config cache | `trading-config.service.spec.ts` — cache describe | `ensureConfig` reads once, caches null, retries after failure, `warmConfig` fills cache, `saveConfig` invalidates (gen token) | PASS | jest suite green |
| S8 | Card-mode regression | `gallery-ticket-dialog`, `gallery-card-actions`, `order-ticket.store` specs + full `npx jest` | card-mode dialog and gallery Trade/Paper/Reject unchanged; whole suite green | PASS | 257/257 suites, 4372 tests |
| S9 | Compile | `npx tsc --noEmit -p tsconfig.app.json` | no errors | PASS | clean |
| S10 | Manual smoke: `open()` from devtools | `ng serve`, log in, call `ManualOrderService.open()` via the injector | — | **N/A** — #1188 has no user-facing surface; the dialog's manual rendering is #1189 and the header trigger is #1191. `open()`'s lifecycle is fully covered by S3/S6. This check moves to #1189's QA. | n/a |

## Traceability

| Acceptance criterion (Task #1188 / QA #1192) | Scenario |
|---|---|
| `buildManualEquityTicket` → STAGED MANUAL buy, no provenance, `{SYM}-BUY-{ts}PT` id | S1 |
| `buildManualOptionTicket` → BTO/STO single-leg, `OPT-MAN-{BTO|STO}-{occ}` id, rejects bad OCC | S2 |
| Builders return null on invalid input | S1, S2 |
| `open()` snackbar+bail on no config; opens with manual seed | S3 |
| `stageEquityTicket` adopt-vs-stage, persists via `stageTicketAndWait` | S4 |
| Same-minute collision guard (bail/adopt, incl. `liv_` twins) | S5 |
| Discard-on-close only session-created STAGED | S6 |
| `discardIfStaged` STAGED-only; shared config cache used by gallery+manual | S6, S7 |
| Card-mode dialog behavior unchanged | S8 |
| Manual UI smoke (`open()` reachable, empty dialog stays open) | S10 |

## Regression / smoke

Full `npx jest --coverage=false` — **257/257 suites, 4,372 tests PASS**
(S8). The only known suite noise is `NG0914` zoneless warnings and
intentional console errors from failure-path tests. A pre-existing
date-bomb fixture in `order.component.spec.ts` was fixed during the
review (relative timestamp) — unrelated to the feature.
