**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1610  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1548  
**Domain:** STRAT-MANAGE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-21  

# UAT — #1548 FE: Create New Strategy dialog + Export-to-JSON

## Scope

The Create New Strategy dialog and Export-to-JSON dialog, per #1548
acceptance criteria:

1. Template picker renders per-leg Δ+DTE inputs from the template shape;
   suggested editable name
2. Save adds an ephemeral ad hoc variant to the session list (no
   Firestore persist)
3. Export-to-JSON dialog emits registry-schema JSON for copy-paste;
   validation rejects incomplete legs + dup names

Review-cycle fixes this UAT also confirms (see
`137-1537-1548-CODE-REVIEW-STRAT-MANAGE-strat-manage.md`): real
`type=number` input events don't crash the dialog; Δ sign parity by leg
type; whole-percent Δ precision; catalog-recipe collision rejection;
uniform-DTE rejection (multi-expiry can't mint an instance ID).

## Prerequisites

- App already running on `http://localhost:4210` (dev server confirmed
  up).
- Signed in — the route is behind `authGuard`.
- Seeded catalog (today): 6 templates — call/put debit spreads (cds,
  pds), call/put credit spreads (ccs, pcs), naked strangle (ns), iron
  condor (ic) — all unbanded; 40 variants generated from the Δ×DTE
  permutation grid, e.g. `call debit spread 30 50-40`,
  `put credit spread 45 15-25`, `iron condor 30 10-20-20-10`.
- **Session variants are ephemeral by design** — a saved ad hoc variant
  survives until page reload, then it's gone. S5 confirms this is
  understood, not a bug.
- The dialog **prefills sensible defaults**, direction-aware: debit
  templates long `0.65`Δ / short `0.55`Δ; credit templates long `0.25`Δ /
  short `0.35`Δ; directionless `0.30`Δ; DTE `30`. Values sit off the
  seeded grid so the suggested name/id are always novel on open (e.g.
  `call debit spread 30 65-55` / `cds-30-65-55`), and the Δ inputs step
  by `0.05` per spinner click. Scenarios below overwrite the defaults.
- Templates carry `uniformDte` + `direction` params: editing one leg's
  DTE syncs all option legs (these shapes share one expiry), and
  ordering is enforced — debit requires `|long Δ| > |short Δ|`, credit
  the reverse. All templates are **unbanded** — any correctly-ordered
  pair is valid (`.9`/`.8` as much as `.2`/`.1` for debit).
- The dialog **stays open after Save** (creation-run workflow — the X
  button top-right is the only close button; backdrop/Escape still
  close) and shows a `Saved '…'` note. **Save/Export disable** while
  the draft is identical to an existing catalog/session variant —
  nothing to save. (A merged registry list was trialled and removed —
  the catalog itself is now fully seeded.)
- S1 optionally writes ONE real `UNSTARTED` doc to
  `st-strategy-instances` — cleanup note in that scenario.

## Getting to the feature

- **Route:** `http://localhost:4210/options/strategy/manage`
- **Entry point:** nav sidebar → **Strategy Manage** (wrench icon)
- **Surface:** the instance table; the **Create New Strategy** button
  sits in the page header immediately left of **Create New Instance**.

## Automated evidence (executed this session)

- `npx jest src/app/features/savant-trader/pages/strategy-manage
  --coverage=false` — 4 suites / 64 tests green, including the
  DOM-driven `type=number` seam test and the header-button test.
- Full suite `npx jest --coverage=false` — 5975 tests pass; 1 foreign
  failure (`portfolio-dashboard.component.spec.ts` — another session's
  mid-edit, unrelated).
- `npm run build -- --configuration development` — clean.
- Post-rename re-verification (naming normalized to dte-first,
  `call debit spread 30 50-40`): `npx jest` over strategy-manage +
  shared manage contracts — 54 suites / 1057 tests green;
  `tsx --test` on the two functions test files — 33 tests green;
  all three `strat-manage-*` verify scripts pass.

## Scenarios

### S1 — Compose a CDS variant end-to-end → instance

- **Confirms:** AC1, AC2, + the E2E chain (variant → picker → ID)
- **Steps:**
  1. Click **Create New Strategy**. Template shows **Call Debit Spread**
  2. Two leg rows appear — `long call` and `short call` — each with a
     Δ target and a DTE input
  3. Enter: long Δ `0.55`, long DTE `35`, short Δ `0.45`, short DTE `35`
  4. Name field auto-fills **call debit spread 35 55-45**; a `Variant
     id: cds-35-55-45` line appears; Save variant is enabled
  5. Click **Save variant** — the dialog **stays open**, a `Saved
     'call debit spread 35 55-45'` note appears, and **Save disables**
     (identical draft = nothing to save) until a leg or name edit
  6. Click the **X** (top-right) to close, then **Create New
     Instance** — the Variant select lists the new variant **call
     debit spread 35 55-45** alongside the 40 catalog entries
  7. Pick it, type symbol `TSLA` — preview shows `TSLA-CDS-35-55-45-ALL`,
     not flagged duplicate
- **Expected:** variant mints, is ephemeral-session only, and composes
  into a correct instance ID.
- **Optional write:** click Create to persist `TSLA-CDS-35-55-45-ALL`
  (UNSTARTED, harmless). Cleanup: delete that doc id in the Firestore
  console under `st-strategy-instances`, or leave it.
- **Result:** ☑ PASS — 2026-11-21 — user-executed: suggested name
  `call debit spread 35 55-45` + id `cds-35-55-45`; dialog stayed open
  on Save with the `Saved '…'` note and disabled Save; variant listed in
  the Create New Instance picker; `TSLA` preview minted
  `TSLA-CDS-35-55-45-ALL`.

### S2 — Suggested name tracks, then yields to the user

- **Confirms:** AC1 (suggested **editable** name)
- **Steps:**
  1. Create New Strategy → fill long `0.50`/`30`, short `0.40`/`30` —
     name shows **call debit spread 30 50-40**
  2. Type `my test variant` into the name field
  3. Change long DTE to `35`
- **Expected:** after step 2 the name stays `my test variant` — the
  suggestion stops tracking once the user edits.
- **Result:** ☑ PASS — 2026-11-21 — user-executed: manual name edit
  pinned; later DTE changes left it untouched.

### S3 — Validation sweep (inline errors, Save/Export disabled)

- **Confirms:** AC3 validation + review-cycle fixes
- **Steps (each is its own mini-case; fix to a clean state between):**
  1. Leave short Δ empty → error mentions `leg 2`
  2. Short Δ `50` → `Δ must be in (0,1]`
  3. Short Δ `-0.5` → sign error (calls positive, puts negative)
  4. Short Δ `0.455` → whole-percent precision error (2 decimals max)
  5. Change one leg's DTE → the other leg's DTE follows (uniformDte
     sync — a same-DTE error can't be produced from the dialog)
  6. Long Δ `0.40`, short Δ `0.50`, DTE `30` → debit-ordering error
     (`|long Δ| must exceed |short Δ|`); equal deltas `0.50`/`0.50`
     also fail
  7. Valid novel recipe + name typed as `call debit spread 30 50-40` →
     name-already-used error
  8. Fill the exact catalog recipe (`0.50`/`30`, `0.40`/`30`) → error
     `already exists in the catalog as cds-30-50-40` (recipe collision
     surfaces before the name check)
- **Expected:** each case shows its specific inline error and keeps
  **Save variant** + **Export JSON** disabled.
- **Result:** ☑ PASS — 2026-11-21 — user-executed: all eight cases
  surfaced their specific inline errors with Save/Export disabled
  (empty leg, Δ range, sign, precision, uniformDte sync, ordering,
  equal deltas, dup name, catalog collision).

### S4 — Export JSON emits registry shape

- **Confirms:** AC3 export
- **Steps:**
  1. Fill long `0.55`/`40`, short `0.35`/`40`; name `export check 55-35 40`
  2. Click **Export JSON** (draft)
- **Expected:** a dialog titled **Export Variant JSON** shows the name
  and pretty-printed JSON containing `"id": "cds-40-55-35"`,
  `"name": "export check 55-35 40"`, `"templateId": "cds"`, `"dte": 40`,
  and a `legs` array with two `{kind,type,side,targetDelta,dte}` entries
  — the `MANAGE_VARIANTS` entry shape. **Copy JSON** copies it (label
  flips to **Copied**); pasting into any editor yields valid JSON.
- **Result:** ☑ PASS — 2026-11-18 shape confirmed (registry-schema
  variant entry vs `MANAGE_VARIANTS`); 2026-11-21 user-executed — Copy
  JSON flips the label to **Copied** and the paste yields valid JSON
  containing `"id": "cds-40-55-35"`, `"dte": 40`, and the two-leg
  `legs` array.

### S5 — Session variants are ephemeral

- **Confirms:** AC2 (no Firestore persist)
- **Steps:**
  1. Save a variant (e.g. S1), confirm it's in the Create New Instance
     picker
  2. Reload the page; reopen Create New Instance
- **Expected:** the ad hoc variant is gone — only the 40 catalog
  variants remain. Also confirm no new doc appeared under
  `st-strategy-instances` or anywhere else for the variant itself.
- **Result:** ☑ PASS — 2026-11-21 — user-executed: reload dropped the
  session variant from the picker; catalog of 40 intact.

## Manual UI/UX refinement pass

- Dialog chrome matches Create New Instance (title, fields, action row)
- Leg rows align (role label, Δ, DTE); error text is readable
- Tab order reaches every field and button; Enter/clicks work
- Disabled states on Save/Export render correctly
- Page header: **Create New Strategy** sits immediately left of
  **Create New Instance**, both grouped right — visually confirmed by
  user 2026-11-18 ("looks good") after SCSS fix moved `margin-left:
  auto` onto the strategy button.
- **Result:** ☑ PASS — 2026-11-21 — user-verified dialog chrome, leg-row
  alignment, error text, tab order, and disabled states match the
  Create New Instance chrome. Same-pass layout fix: the page itself
  scrolled end-to-end — converted to the bounded page contract
  (`vl.page-host`/`page-shell` + `.table-wrap` single scroller under
  `dense-table`'s sticky thead); user confirmed "much better".

## Findings

- 2026-11-21 — Page-level scroll (user-reported, fixed in-gate): the
  whole manage page scrolled — tabs/filters/table-header left the
  viewport on long tables. Fixed via the bounded page contract:
  `:host` → `vl.page-host`, `.strategy-manage` → `vl.page-shell`, new
  `.table-wrap` (`flex:1; min-height:0; overflow-y:auto`) so only rows
  scroll under the sticky thead; header/filter `flex-shrink:0`.
  `strategy-manage.component.{html,scss}` — rides the #1548 ship
  commit. 70/70 strategy-manage specs green post-change.
- 2026-11-18 — Naming inconsistency (user-reported, resolved):
  `MANAGE_VARIANTS` names were delta-first (`call debit spread
  50-40 30`) while variant/instance ids were dte-first
  (`cds-30-50-40`, `QQQ-CDS-30-50-40-ALL`). Decision: keep dte-first
  everywhere; names rewritten to `call debit spread {dte}
  {Δlong}-{Δshort}` across catalog, suggested-name generator, specs,
  verify scripts, functions tests, and current docs. No id migration —
  ids were already dte-first, so persisted/live identifiers untouched.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Template picker renders per-leg Δ+DTE inputs from template shape; suggested editable name | S1, S2 |
| Save adds ephemeral ad hoc variant to session list (no Firestore persist) | S1, S5 |
| Export to JSON dialog emits registry-schema JSON for copy-paste | S4 |
| Validation rejects incomplete legs + dup names | S3 |
| Review fix: number-input seam, sign parity, percent precision, catalog collision, uniform DTE | S3 + automated |

## Regression / smoke

- [x] Create New Instance dialog still opens and previews catalog
  variant ids (`QQQ-CDS-30-50-40-ALL`)
- [x] Instance table renders; Start/Stop still work
- [x] Page header shows both create buttons, right-aligned

## Verdict

**PASS** — 2026-11-21 — all five scenarios user-executed green on the
live dev build; refinement pass green including the page-scroll fix;
regression smoke green; automated evidence 70/70 + full-suite green.

## Results log

- 2026-11-18 — Doc created at QA start (#1610). Awaiting user-run live
  pass on `http://localhost:4210/options/strategy/manage`.
- 2026-11-18 — Route/port corrected 4200 → 4210; header button order
  fixed (Create New Strategy left of Create New Instance, both
  right-aligned) — user confirmed visually.
- 2026-11-18 — User opened Export JSON dialog; registry shape
  confirmed; surfaced naming inconsistency → normalized dte-first
  (`call debit spread 30 50-40`). Re-verified: 1057 jest + 33
  functions tests + 3 verify scripts green. Remaining scenarios
  (S1–S3, S5, copy-to-clipboard) still open.
- 2026-11-21 — Gate resolved PASS. User ran S1–S5 + refinement + smoke
  on `http://localhost:4210/options/strategy/manage`; the page-scroll
  defect found in the same pass was fixed in-gate (bounded page
  contract) and re-verified. QA #1610 closed RESOLVED.
- 2026-11-18 — Catalog expanded: `MANAGE_TEMPLATES` now seeds 6 shapes
  (cds/pds/ccs/pcs/ns/ic); `MANAGE_VARIANTS` seeds 40 entries from the
  Δ×DTE permutation grid (generator: `.devin/tmp/gen-manage-variants.ts`,
  JSON mirror `.devin/tmp/manage-variants.json`). Dialog defaults moved
  off-grid (debit .65/.55, credit .25/.35, directionless .30) so the
  opening recipe stays novel. Registry/session list removed from the
  dialog per user feedback. Re-verified: 1153 jest + both affected
  verify scripts green. Instance picker now lists 40 catalog variants.
