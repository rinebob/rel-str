**Topic:** Manual Order Entry  
**Topic Slug:** manual-order  
**Thread:** Header Order Ticket  
**Thread Slug:** header-order-ticket  
**Issue:** #1184  
**Thread Parent:** #1178  
**Topic Parent:** #1177  
**Task:** #1189  
**Domain:** ORDER  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-22  

# CODE-REVIEW — #1189 GalleryTicketDialog manual mode (Stock tab)

## Verdict

**PASS** — three remediation rounds, converged on round 4. Round 1:
four majors. Round 2: stale-spec blocker + minors. Round 3: one MAJOR
adoption gap + spec gaps. Round 4 verified the round-3 fix holds on a
clean re-read — no new findings; the axes are down to the documented
deferreds, so the loop stops here (scope discipline).

## Scope

Working-tree diff (uncommitted at review time):

- `components/gallery-ticket-dialog/gallery-ticket-dialog.component.{ts,html,scss,spec.ts}`
- `components/option-order-ticket/option-order-ticket.component.{ts,html}`
  — added during remediation (the manual placeholder)
- `src/main.ts` — disclosed TEMP dev hook (`__manualOrder`), revert
  before commit; not a ship surface.

## Round 1 findings → dispositions

### Standards

- **Vacuous `fetchPrices` assertion** (spec — the card fixture's
  `ngOnInit` already fetched `['AAPL']` into the shared mock, so the
  resolve assertion passed even if the resolve never fetched) →
  **fixed**: explicit `mockClear()` inside the resolve spec.
- **Manual Option tab wrong-domain error** — empty provenance always
  failed `ensureStagedTicket` at "all occurrences rejected — restore to
  trade" after burning `getOptionChains`/snapshot calls → **fixed**:
  `manual = computed(() => runId() === '')` placeholder in the option
  component (the sentinel the IMPL doc already specified for #1190);
  the tab still mounts (AC) but shows an honest "not available yet".
- **Duplicated quote probe** (`prices()[sym] === undefined` vs the
  service's `!price`, plus duplicating the service's own internal
  fetch) → **fixed**: probe deleted; stage-first, strip warms
  reactively.
- **Unhandled rejection** — `resolveSymbol` had `finally` but no
  `catch`; a `stageEquityTicket` throw (e.g., `ensureConfig`) escaped
  the click binding with zero feedback → **fixed** + spec.
- **Missing coverage** — seed-returns-null branch and the `resolving`
  re-entry guard untested → **fixed** (specs added).
- **Stale class doc** (card mode only) → **fixed**.
- **File size** — component ~380 lines (>300 guideline), spec ~700
  (>400) → **nit, deferred**: the dialog grows again in #1190; a
  cohesion split is better evaluated once the full manual surface lands.
- **Rekey edge** — post-resolve store hydration rekeys bare→`liv_`;
  `ticket()` goes null while `enteredSymbol` stays set → **minor,
  acceptable**: `OrderTicketComponent.ticket` is `input<OrderTicket |
  null>` with `?.` throughout, so the Stock tab degrades to an empty
  form rather than crashing; the same deferred store-level race already
  documented in the #1188 review (F2).
- **Duplicated tab-group markup** (manual vs card branch) → **nit,
  retained**: the branches diverge further in #1190 (manual option
  provenance) — extraction now would churn twice.

### Spec

All eight acceptance criteria accounted for:

1. Manual variant renders symbol entry before tabs — **met** (+ spec).
2. Valid symbol stages MANUAL ticket, binds Stock tab, shows quote
   strip — **met** (+ spec; the strip is the shared title-row `quote()`
   driven by `displaySymbol()`).
3. Invalid/unresolvable → inline error, nothing staged, editable —
   **met**; the seed-null branch was initially untested → spec added.
4. Tabs render post-resolution; Option tab needs no card seed —
   **met**; a spec actually activates the lazy tab and mounts the
   component (asserts the manual placeholder, not the signal form).
5. `onStaged` `{ticketId, created}`; adopted → `created:false` —
   **met**, emitted inside the service's seed wrapper (only the service
   knows created-vs-adopted; the seed returns a bare ticket). IMPL doc
   line corrected to match — it had the emit in the dialog.
6. Submit path unchanged; confirmation on done — **met**; a spec now
   drives the panel via a real store status transition (the prior spec
   set `confirmation` directly).
7. Manual View-order → `PORTFOLIO_DASHBOARD`; card `?ticket=` unchanged
   — **met** (+ specs both directions).
8. Specs green; card-mode specs stay green — **met** (see Test results).

- `enteredSymbol` stale-after-failed-resolve → **moot**: re-resolve is
  now gated while a ticket is bound; pre-bind failure never sets it.

### Thermo-nuclear

- **MAJOR — re-resolve while a ticket is bound orphaned and silently
  rebound.** A second resolve staged a second persisted ticket,
  overwrote `manualTicketId`, and left the first STAGED ticket in the
  order queue until close; during SUBMITTING it would hide the real
  order's confirmation → **fixed**: resolve is gated on `!ticket()`
  (method guard + disabled input/button + "close to change symbols"
  hint + spec).
- **MAJOR — Option tab dead-ended on a false error** (see Standards) →
  **fixed** (manual placeholder).
- **MAJOR — `await fetchPrices` didn't prove a quote landed** (dedupe
  via `lastRequestedSymbols` set before the await; stale cache passed
  the probe) → **fixed**: probe removed; the seed does its own fetch
  for sizing; `fetchPrices` is a non-blocking strip warm.
- **MAJOR — unhandled rejection on stage failure** → **fixed** (see
  Standards).
- **MINOR — external discard left stale `confirmation` masking the
  entry row** → **fixed**: the `!ticket` manual branch clears it.
- **MINOR — `confirm-hint` said "Live Orders page" while manual
  View-order routes to the portfolio dashboard** → **fixed**: mode-aware
  copy.
- **NITs retained:** `$any($event.target)` in the template (Angular
  input-binding idiom); `[runId]="''"` magic empty-string sentinel
  (documented in both files; #1190 replaces it with a real manual
  path); service `_staging` guard unreachable behind `resolving` +
  `_dialogOpen` (cheap defense, left); `main.ts` TEMP hook disclosed.

### Deferred (documented, not blocking)

- **Store-level rekey race** (bare→`liv_` while a bare id is held) —
  same F2 from the #1188 review; the dialog-side consequence is now
  verified non-fatal (empty form, no crash). Fix belongs in
  `OrderTicketStore.loadTickets`.
- File-size split — revisit after #1190.

## Round 2

All three axes re-verified the round-1 fixes hold (traced, not taken on
faith). New findings — all remediated except documented nits:

| Finding | Fix |
|---|---|
| **BLOCKER (all axes) — `option-order-ticket.component.spec.ts` drove a removed contract.** Concurrent #1017 work deleted the `decisions` input + REJECT filtering from `OptionOrderTicketComponent`/`OptionTabSeed`, but the spec still called `setInput('decisions', …)` and three specs asserted deleted REJECT-block/retry/filter behavior — the suite could not pass | Spec reconciled to the new contract: `decisions` opt + `setInput` removed, `rejectDecision` helper + `StOccurrenceDecision`/`ReviewDecision` imports removed, the three REJECT specs deleted (reject is now session-ephemeral card state — the component has no signal to read; removal verified intentional per `triage.store.ts`). `decisionId` retained — live specs still use it for ticket fixtures |
| **MINOR — manual placeholder burned MCP calls.** `manual-option-placeholder` renders nothing selectable, yet the chains/cash/alloc warm effects still fired behind it | All three fetch effects gated on `!manual()` |
| **MINOR — vanished bound ticket left a dead form.** `enteredSymbol`/`manualTicketId` persisted → tabs rendered `app-order-ticket` on a null ticket beside a re-enabled entry row | The `!ticket` manual branch now clears all three (`confirmation`, `enteredSymbol`, `manualTicketId`) — the dialog resets to a clean entry row |
| **MINOR — stale comments/mocks.** Option `manual` doc claimed pickers preview contracts; retry-effect comment cited "un-rejected" (dead post-#1017); dialog spec `optionSeed` carried a `decisions` field `OptionTabSeed` dropped | All removed/corrected |

**Attribution note (#1017, user-authored, verified coherent):**
`ManualOrderDialogSeed.initialSymbol?` → `symbolInput` prefill +
`ngOnInit` auto-resolve — normalize/validate ordering is correct,
failure leaves the field editable, the bound-ticket gate covers it.
Coverage gap (no spec for the prefill path) noted as acceptable —
exercised by the same resolve path the specs drive.

**Deferred / not fixed (documented):**
- `!ticket` early-return ordering vs the option orphan/done effect
  branches — inconsistent shape for #1190's real manual option emits;
  #1190 reworks this watcher anyway. Latent, harmless today (manual
  `optionTicketId` is unreachable).
- `runId()===''` magic-string sentinel — the IMPL doc's specified seam;
  #1190 replaces it with the real manual path.
- Store bare→`liv_` rekey race (round-1 F2) — unchanged; the round-2
  reset now makes the dialog-side consequence a clean entry row.
- `gallery-view.component.ts` "seed + live decisions" comment — outside
  this diff (user's #1017 file).

## Round 3

All three axes re-attacked the post-round-2 diff; every prior fix
verified holding (traced). New findings:

| Finding | Fix |
|---|---|
| **MAJOR (thermo) — `stageEquityTicket` adopted only `source === MANUAL` STAGED tickets.** A signal-sourced STAGED equity ticket for the symbol got a parallel manual duplicate — two submittable orders for one underlying (the same-minute twin check only catches same-id collisions). Live (non-STAGED) tickets also went unchecked | `existing` probe broadened to ANY STAGED equity ticket for the symbol (adopt, `created:false`); a non-STAGED equity ticket now blocks with a "live order already exists" snackbar — mirrors `signal-review.facade.tradeSymbol`'s adopt/block semantics. Specs: signal-STAGED adoption, option-only stages fresh, non-STAGED blocks, same-minute STAGED twin adoption |
| **Spec gaps (spec + thermo)** — `initialSymbol` auto-resolve, vanish→entry-row reset, and manual-mode MCP gating rested on inspection only | 3 specs added: seeded `initialSymbol` prefills + auto-resolves once; bound-ticket vanish clears `enteredSymbol`/`manualTicketId` and re-enables the input; `runId=''` option mount burns zero MCP/portfolio/alloc calls |
| Stale comment `gallery-view.component.ts` "precomputed seed + live decisions" (field dropped in #1017) | Corrected (comment only) |

**Deferred / not fixed (documented):**
- `open()` silently swallows a second call while `ensureConfig` awaits
  (a dialog is already in flight — arguably correct; a snackbar or
  dialog-focus would need a `boolean` return through the facade's await
  — cosmetic edge).
- Double error surfacing on stage failure — the persistent inline line
  (generic) plus the service's specific snackbar (auto-dismisses). Both
  stay: the inline survives the snackbar's fade.
- Ungated non-fetch effects in the option component (`:373`/`:401`/`:432`)
  — inert on empty inputs today; #1190 wires the real manual path.
- `runId()===''` sentinel, effect ordering vs option watchers,
  bare→`liv_` rekey race — unchanged from earlier rounds.

## Test results

- Focused post-round-3: `gallery-ticket-dialog` + `option-order-ticket`
  + `manual-order.service` suites — 111/111 green (34 dialog, 48
  option, 29 service).
- Full suite post-round-3: 255/257 suites pass; the two flagged
  failures (option-order-ticket 'loads expirations', option-chain
  integration) were mid-edit artifacts — both green on a clean rerun.
  The 8 `occurrence-decision.store` spec failures from round 2 were
  resolved by the user's #1017 spec updates (no longer in the run).
- `tsc --noEmit -p tsconfig.app.json` clean.

## Manual UI verification

Dev-only entry until #1191 wires the header button: `ng serve` + devtools
`__manualOrder.open()` (TEMP hook in `main.ts`, revert before commit).
Stages real tickets into prod Firestore — discard-on-close cleans up;
do not click Place Order in the click-through.
