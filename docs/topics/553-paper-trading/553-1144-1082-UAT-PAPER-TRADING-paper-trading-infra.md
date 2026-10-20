# UAT — #1082 FE analysis route + dataset library + run-config form

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1144  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1082  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-19  
**Last Updated:** 2026-10-19  

## Scope

First user-facing surface of the workbench: `trading/analysis` route,
dataset library card grid, run-config form calling
`generateTradeDataset`, nav affordances. Verification splits between
the spec suite (behavior) and a manual click-through on the dev server
(visual/interaction).

## Prerequisites

- `npm start` running (user's dev server on :4210) — the #1081 service/
  store + rules deploy (2026-10-19) are the backend dependencies.
- At least one `analysis-datasets` index doc in prod to see a populated
  card; none = the empty state is exercised instead.

## Scenarios

| # | Feature | How to verify | Expected | Result |
|---|---|---|---|---|
| S1 | Route + nav | Nav Trading → Analysis; Paper page header 'Trade Analysis' link | `trading/analysis` loads auth-gated; nav item + paper-header link both reach it | **USER** — click-through |
| S2 | Library provenance at a glance | Open the page with existing datasets | Per card: origin badge, status chip, labeled Rule/Scope/Generated lines, tags, notes; page subtitle explains what a dataset is; failed cards show error | **USER** — re-check after R1 labels |
| S3 | Search | Type a symbol / tag / dataset id fragment | Cards filter to matches; nonsense query → 'No datasets match' empty state | **PASS** — spec: search narrows list by symbol/name/tag + empty-state text |
| S4 | Generating pending + poll | A `generating` dataset present (or after S6 submit) | Spinner inside status chip; Open disabled; library re-fetches every ~5 s until status flips; `failed` shows error | **PASS** — spec: pending chip, disabled Open, fake-timer poll, failed error line. Visual confirm in S6 |
| S5 | Tags/notes inline edit | 'Tags / notes' → edit → Save | `updateTagsNotes` fires with parsed tags + notes (empty notes → explicit clear); card reflects values | **PASS** — spec: save writes parsed tags/notes, empty notes → null |
| S6 | Run-config submit | 'New dataset' → Replay defaults → Generate | Callable fires once; panel closes; a `generating` card appears on the next refresh | **USER** — real callable; watch the new card flip ready/failed |
| S7 | Invalid input blocked | Enter `exit-14d` or blank exit rule → Generate | Validation error renders, callable **never** fires (spec-level: `submitted` never emits); inverted bar range same | **PASS** — specs: bad grammar + inverted range emit nothing |
| S8 | Live snapshot mode | Toggle to Live | Run params hide; only tags/notes remain; a stale invalid replay field cannot block submit | **PASS** — spec: replay controls disable; stale-invalid submit emits LIVE_DEFAULTS |
| S9 | Delete | Delete → Confirm | Two-step confirm (no dialog); doc+object deleted, card leaves the grid; 'Keep' cancels | **PASS** — spec: first click asks, confirm deletes, Keep cancels |
| S10 | Open | 'Open' on a ready dataset | `store.openDataset` loads rows; the opened card shows an interim 'N rows loaded' banner until the #1083 table lands | **PASS** — spec: Open calls openDataset + banner spec'd; visual confirm with S2 |
| S11 | Empty + loading states | Fresh account / hard-refresh | Spinner while first load; 'No analysis datasets yet' empty state; error banner on store error | **USER** — click-through (empty state spec-pinned) |
| S12 | Typecheck + build | `tsc -p tsconfig.app.json`; `ng build` | clean; AOT compiles the lazy chunk | **PASS** |

## Traceability

Every #1082 acceptance criterion maps: provenance+search → S2/S3 ·
generating pending+refresh → S4/S6 · invalid-input suppression →
S7/S8.

## Execution evidence

- `npx jest` (8 targeted suites incl. page + form + store + service +
  util + routes + nav + paper link) — **255/255 green**, re-run for QA
- `tsc -p tsconfig.app.json` — clean · `ng build` — clean
- Refinement pass: two review findings already hardened (disabled-
  control validators, token conformance) — no further refinement items
  surfaced

## Refinement log

- **R2 (2026-10-19, user report):** "Symbol and strategy have to be much
  more prominent." Fix: card title line `{scope} · {exitRule}` in large
  weight above the params rows; Rule row folded into Params
  (convention + barRange); dataset id stays as small provenance.
  **Deferred (user-noted, not a blocker):** card grid won't scale to
  hundreds/thousands of datasets — library layout (dense table / list /
  virtual scroll) is a future-task concern; flagged for #1083+ planning.

- **R1 (2026-10-19, user report):** "I see three cards but not sure what

- **R1 (2026-10-19, user report):** "I see three cards but not sure what
  they represent or what to do with them — metadata is good but there's
  no labeling." Fixes: page subtitle explaining datasets
  (replay = historical signals through an exit rule, live = paper-ledger
  snapshot, Open loads into the workbench); labeled Rule/Scope/Generated
  lines on each card; opened card shows an interim '● Open — N rows
  loaded' banner since the workbench table lands with #1083. 2 new
  specs; 26/26 page specs green.

## Manual results (user click-through)

| Scenario | Result |
|---|---|
| S1 Route + nav | **PASS** (user) |
| S2 Provenance | **PASS** (user, post-R1/R2 labels) |
| S6 Generate replay → generating → ready | **PASS** (user) |
| S11 States | **PASS** (user) |

**Result: PASS** — #1082 ship-eligible.
