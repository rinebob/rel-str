**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1669  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1504  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# UAT — FE Task: Variant builder dialog (#1504)

## Scope

Shared variant-builder dialog — the single composition surface that
named-variant, base-template, and from-scratch modes funnel through to
concrete `VariantLeg[]`. Delivered: pure utils
(`variant-builder.utils.ts`), a dialog-scoped `VariantBuilderStore`
SignalStore, and `OptionsVariantBuilderDialogComponent` — intentionally
not wired to any route or caller (entry points are #1505/#1506).

Task acceptance criteria:

1. Named-variant mode returns `{ variantId }` and previews the registry
   variant's concrete legs read-only.
2. Base-template mode renders per-leg concrete Δ/DTE pickers bounded by
   each shape leg's `deltaBand`/`dteBand`; stock legs render fixed.
3. From-scratch mode supports free-form add/remove leg rows on the full
   pick grid; the composed-legs preview updates live.
4. Copy JSON produces paste-ready `ReplayVariant` registry-block JSON
   that round-trips `validateVariantLegs`.
5. `submitLabel` via `DS_DIALOG_DATA` (Run/Apply per destination);
   optional `variantName` on shape/scratch submit.
6. Feature state lives in a dedicated signal store — no component-local
   lifecycle state.

Review-round fixes this UAT also confirms: dialog width fitted to the
480px DS pane contract (560→440px); 8-leg request boundary mirrored
client-side; `variantName` maxlength 200; Copy JSON gated on valid
composition + non-reserved/non-colliding export id.

## Prerequisites

- Repo checkout on branch `prod`; `npm install` already run.
- The dev server is already running — no server start needed. **Note:**
  this task ships no route or caller, so there is no in-app surface to
  navigate to; every scenario below is executed through the jest spec
  suite, which renders the real component template under
  jest-preset-angular.
- Concrete registry values used by the specs and Copy-JSON checks:
  - Variants: `csp-45-20` (short put, Δ −0.45 / 20 DTE), `csp-30-30`
  - Shapes: `put-credit-spread` (2 option legs, band-bounded pickers),
    `iron-condor` (4 option legs), `covered-call` (option + stock leg —
    the stock row renders fixed with no pickers)
  - Reserved registry id sentinel: `custom`

## Getting to the feature

Route: **none yet** — entry-point wiring is #1505 (replay run dialog)
and #1506 (strategy build). The executable surface today is:

- Component spec:
  `npx jest options-variant-builder-dialog --coverage=false`
- Utils spec:
  `npx jest variant-builder.utils --coverage=false`
- Full backtest surface:
  `npx jest src/app/features/savant-trader/backtest --coverage=false`
- Typecheck: `npx tsc --noEmit -p tsconfig.app.json`

Each scenario names the exact `it(...)` assertions that prove it; run
the suite and confirm each named spec passes.

## Automated evidence (executed this session)

- `npx jest variant-builder --coverage=false` — 2 suites / **30 tests** green
- `npx jest src/app/features/savant-trader/backtest --coverage=false` — 16 suites / **214 tests** green
- `npx tsc --noEmit -p tsconfig.app.json` — clean

## Scenarios

### S1 — Named-variant mode

- **Confirms:** AC1 — variant dropdown lists every registry variant,
  defaults to the first; preview shows the registry variant's concrete
  legs; submit emits `{ variantId: 'csp-45-20' }` (no legs/name fields).
- **Steps:** run the component spec; check the three specs named below.
- **Expected — specs PASS:**
  - `lists every named variant and defaults to the first`
  - `named mode exposes the registry legs in the preview`
  - `named submit emits the variantId request form`
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S2 — Base-template mode: band-bounded pickers

- **Confirms:** AC2 — for shape `put-credit-spread` each option leg gets
  Δ and DTE selects whose options are exactly the grid values inside the
  leg's `deltaBand`/`dteBand` (no out-of-band picks offered); dialing
  produces signed concrete legs (PUT legs negative Δ).
- **Steps:** run the component spec; check the specs named below.
- **Expected — specs PASS:**
  - `shape mode renders one band-bounded Δ + DTE picker per option leg`
  - `dialed picks compose to signed concrete legs in the preview`
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S3 — Stock legs fixed in shape mode

- **Confirms:** AC2 edge — `covered-call`'s stock leg renders as a fixed
  row with no Δ/DTE pickers and passes through composition untouched.
- **Expected — specs PASS:**
  - `a shape with a stock leg renders it as a fixed row (no pickers)`
  - utils: `passes stock legs through untouched` (`composeShapeLegs`)
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S4 — Shape submit emits `{legs, variantName?}`

- **Confirms:** AC5 — shape submit emits composed legs + optional
  trimmed `variantName`; never a `variantId`. Blank name omitted.
- **Expected — spec PASS:** `shape submit emits {legs, variantName?} — no variantId`
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S5 — From-scratch mode: add/remove + compose

- **Confirms:** AC3 — scratch starts with one row; Add adds a row,
  remove deletes it; option + stock rows compose to valid concrete legs
  on the full pick grid (not shape-banded).
- **Expected — specs PASS:**
  - `scratch mode: add/remove leg rows`
  - `scratch rows compose valid legs (option + stock mix)`
  - utils: `converts scratch rows the same way` (`composeScratchLegs`)
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S6 — Live preview + determinism

- **Confirms:** AC3 — `composedLegs` recomputes per state change;
  identical inputs always yield identical output (no ordering drift).
- **Expected — spec PASS:** `same composition twice produces identical legs`
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S7 — Copy JSON: paste-ready registry block

- **Confirms:** AC4 — Copy JSON writes `navigator.clipboard` a
  `ReplayVariant` block `{id, name, description, structure, legs}` whose
  `legs` round-trip `validateVariantLegs` with zero errors; scratch-mode
  export stamps `structure: 'custom'`.
- **Expected — specs PASS:**
  - `Copy JSON writes a paste-ready ReplayVariant block`
  - `scratch-mode export stamps structure custom`
  - utils: `emits the paste-ready ReplayVariant fields`
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S8 — Negative: invalid / duplicate composition

- **Confirms:** AC4 guard — a duplicate-leg scratch composition surfaces
  `legErrors`, disables Run/Apply, `submit()` never calls
  `dialogRef.close`, and `exportJson` returns `''`.
- **Expected — specs PASS:**
  - `an invalid composition blocks submit`
  - `duplicate scratch legs surface legErrors and block submit`
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S9 — Boundary: 8-leg request cap

- **Confirms:** review fix — `optionsReplayStart` rejects `legs.length > 8`
  with `invalid-argument`; the client mirrors it (`MAX_VARIANT_LEGS`):
  attempting 10 adds yields exactly 8 rows and the Add button disables.
- **Expected — spec PASS:** `Add-leg is capped at the request boundary (8 legs)`
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S10 — Export id gating

- **Confirms:** review fix — `exportJson` returns `''` when the export id
  is `custom` (reserved sentinel) or collides with a registry id
  (`csp-45-20`); a free id (`scratch-ok`) emits JSON.
- **Expected — spec PASS:** `Copy JSON is gated on a valid composition + free registry id`
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S11 — submitLabel via DS_DIALOG_DATA

- **Confirms:** AC5 — `submitLabel` comes from dialog data (`Apply` for
  the strategy-build destination), defaulting to `Run`.
- **Expected — specs PASS:**
  - `submitLabel comes from dialog data (Apply destination)`
  - `submitLabel defaults to Run`
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S12 — Cancel hygiene

- **Confirms:** cancel closes the dialog with `undefined` — no partial
  submission, no emitted state.
- **Expected — spec PASS:** `cancel closes with undefined — no partial submission`
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

### S13 — Registry round-trip: every seeded shape

- **Confirms:** AC2/AC4 systemic check — dialing every seeded shape in
  `REPLAY_TEMPLATE_SHAPES` to defaults yields `validateVariantLegs`-clean
  legs (no seeded shape is uncomposable).
- **Expected — spec PASS:** `dialing every seeded shape to defaults yields valid legs`
- **Result:** ☑ PASS — spec suite green 2026-11-22 (30/30 builder specs)

## Manual UI/UX refinement pass

**Not applicable — no reachable surface.** The dialog is intentionally
un-wired: no route or caller can open it until #1505 wires the replay
run-dialog entry. The rendered-DOM structure (mode select, per-leg
pickers, add/remove, preview, field-error markers, disabled states) is
already exercised by the component specs above.

**Deferred to #1505 QA** — when the dialog first opens live, eyeball:

- [ ] Opens inside the ~480px DS pane without horizontal scroll;
      scratch row's 5 selects + remove button fit unclipped at 440px host
- [ ] Mode switch transitions (named → shape → scratch) re-render
      cleanly; preview updates visibly per picker change
- [ ] leg-error state styling reads correctly (`field-error` marker is
      unstyled by design — confirm acceptable or add a rule then)
- [ ] Add-leg disabled state reads as disabled at 8 rows
- [ ] Density/spacing consistent with `options-replay-new-run-dialog`
      siblings

## Findings

None from automated execution. One standing caveat: the live visual
pass is deferred to #1505 QA (see above) — the first real render happens
inside the replay run dialog, which is the earliest point a clipped or
mis-sized layout could be observed in-app.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Named-variant mode → `{variantId}` + read-only preview | S1 |
| Base-template pickers bounded by `deltaBand`/`dteBand`; stock fixed | S2, S3, S13 |
| From-scratch rows + live composed-legs preview | S5, S6 |
| Copy JSON → paste-ready `ReplayVariant` round-trip | S7, S8, S10 |
| `submitLabel` via data; optional `variantName` | S4, S11 |
| Dedicated signal feature store (no component-local state) | S1–S12 (all specs run against the store); code-review Standards axis |
| 8-leg request boundary (review fix) | S9 |
| Cancel → no partial submission (TEST doc edge case) | S12 |

## Regression / smoke

- `npx jest src/app/features/savant-trader/backtest --coverage=false` —
  16 suites / 214 tests green; `options-replay-new-run-dialog` and all
  sibling surfaces unaffected (new files only, zero edits to existing
  code)
- `npx tsc --noEmit -p tsconfig.app.json` — clean

## Verdict

PASS — all 13 scenarios green via spec execution; manual visual pass
deferred to #1505 QA (no reachable surface by design; deferred checklist
recorded above).

## Results log

| Date | Task | Executor | Result | Notes |
|---|---|---|---|---|
| 2026-11-22 | #1504 | Devin | PASS | 30/30 builder specs, 214/214 backtest surface, tsc clean; visual pass deferred to #1505 (dialog un-wired) |
