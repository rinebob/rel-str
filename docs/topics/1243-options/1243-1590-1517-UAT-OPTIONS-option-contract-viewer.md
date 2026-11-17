**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1590  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1517  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — #1517 FE Task: Reset control for the group generator

## Scope

One-click **Reset** for the OCC group-generator panel: every drawer field —
query axes, query type, expiration lists (both Query and Refine free-text
fields), refine axes + type, alive-across study-range bound, open date +
range-link toggle, generated results, column sort, lines preview — returns
to defaults; the per-symbol persisted settings blob is cleared; an armed
study-range brush disarms so a later chart drag cannot silently re-create
the bound + saved settings.

## Prerequisites

- Dev server already running; app open at any page.
- Symbol **QQQ** loaded (the page restores the last-used symbol; if the
  chart shows a different symbol, type `QQQ` into the symbol field in the
  controls panel and wait for the chart to load).
- No data setup needed — the generator queries the live availability
  endpoint on **Run**.

## Getting to the feature

1. Navigate to **`/options/chart`** (nav: **Options → Chart**).
2. In the chart header bar (top-left), click the **`tune` icon button**
   (tooltip "Controls panel") — the left controls panel opens.
3. Inside the left panel, expand the **"Group generator"** accordion —
   the panel lands on the **Group Generator** form: header (`Group
   Generator` title + symbol), Query axes, Run button, preview table,
   Refine section, Open Date, and the Send button.

The **Reset** control is the small text button at the **right end of the
"Group Generator" header row**, next to the symbol.

## Automated evidence

- `npx jest option-group-generator/ option-group-generator.store.spec.ts
  --runInBand` — **42/42 pass** (component DOM + store specs), including
  the new header-Reset DOM spec and the every-field store reset spec.

## Scenarios

### S1 — Full-field reset

**Starting state:** generator expanded, symbol QQQ.

1. Fill the Query axes: Strike From `400`, Strike To `500`, Step `5`,
   Exp From `2026-06-01`, Exp To `2026-12-31`, type **Calls**, Expirations
   field `2026-06-19, 2026-07-17` (blur to commit).
2. Click **Run** — wait for the preview table ("N contracts").
3. Fill the Refine axes: Strike Min `450`, type **Calls**, Expirations
   field `2026-06-19` (blur to commit).
4. Set **Open date** `2026-02-02` and check "Use study-range start as
   open date" off/on (either — the point is it's not default).
5. Click the **Exp** column header once — a `1↑` sort indicator appears.
6. Click **view lines** — the `<pre>` of `date,id` lines opens.
7. Click **Reset** (header, right side).

**Expected:** every input returns to empty/default — query axes blank,
type back to **Both**, both expiration-list fields blank, all refine
fields blank + type **All**, open date empty, sort indicator gone, the
preview table is replaced by `Set axes and press Run to preview
contracts.`, the lines preview is gone, and the Send button is disabled
with the `Run and refine to a non-empty set first` hint.

**Result:** PASS — user-run

### S2 — Persisted settings cleared

**Starting state:** immediately after S1.

1. Reload the page (F5).
2. Re-open the controls panel → expand **Group generator**.

**Expected:** all fields still at defaults — the pre-reset axes are NOT
restored (the saved `rs-optgen:QQQ` blob was deleted). *(Equivalent check:
swap symbol to `SPY` and back to `QQQ` — fields stay defaults.)*

**Result:** PASS — user-run

### S3 — Bound + armed brush does not resurrect

**Starting state:** generator at defaults, at least one contract plotted
on the chart (paste `QQQ261016C00710000` in the textarea and Load, or send
from a prior Run).

1. Click **Select range** in the chart header — it gains the active
   highlight (armed).
2. Drag a range across the chart — the Refine section shows an
   `Alive across {start} → {end}` row and the chart shows the bound band.
3. Click **Reset** in the generator header.

**Expected:** the `Alive across` row disappears, the bound band
disappears from the chart, **Select range loses its active highlight**
(brush disarmed), and any bound-hidden series restore.
4. Now drag on the chart again (without arming).

**Expected:** NO bound is re-created — no `Alive across` row, no band.
Before this fix, an armed brush left over from the reset could re-write
the bound and re-create the settings blob on the next drag.

**Result:** PASS — user-run

### S4 — Mid-run reset discards the late response

**Starting state:** generator at defaults.

1. Set only Exp From `2025-01-01` and Exp To `2026-12-31` (a wide query —
   slower to return).
2. Click **Run**, then click **Reset** while `Querying availability…`
   is still showing.
3. Wait ~10 seconds.

**Expected:** the spinner disappears immediately on Reset; when the
fetch lands, no records appear — the panel stays on
`Set axes and press Run to preview contracts.` (in-flight run invalidated).

**Result:** PASS — user-run

### S5 — Sort and lines preview reset (fields that used to escape)

**Starting state:** generator at defaults.

1. Run any query (e.g. just click **Run** with empty axes).
2. Click the **Strike** column header twice — sort indicator shows `1↓`.
3. Click **view lines** — the `<pre>` opens.
4. Click **Reset**.

**Expected:** sort indicator gone, lines preview collapsed. Then Run
again: the table renders unsorted and the lines preview does NOT
re-open on its own.

**Result:** PASS — user-run

### S6 — Pristine drawer is a safe no-op

**Starting state:** generator at defaults (fresh load or post-Reset).

1. Click **Reset**.

**Expected:** nothing changes, no error/spinner flash — idempotent.

**Result:** PASS — user-run

## Manual UI/UX refinement pass

- [ ] Reset is visible in the header without scrolling the panel — the
  original QA complaint was that the reset couldn't be found; confirm a
  fresh look at the drawer finds it.
- [ ] Button reads "Reset" with a sensible hover tooltip
  (`Reset axes, refine, results, and saved settings`), styled like the
  neighboring "view lines" text button.
- [ ] Run button still spans the Query actions row after the old Clear
  button's removal.
- [ ] Select range × button and armed highlight behave consistently
  after Reset.

## Findings

None — all scenarios passed on first run.

## Traceability

| Criterion | Scenario |
|---|---|
| One click returns every field to defaults (query params, refine filters, open date, generated results) | S1 |
| Persisted settings blob cleared | S2 |
| Armed brush cannot resurrect bound + blob (review remediation) | S3 |
| In-flight run invalidated on reset | S4 |
| Sort + lines preview reset (previously escaping fields) | S5 |
| Drawer-local free-text expiry fields reset | S1, S5 |
| Discoverability (original QA complaint) | Refinement pass |
| No-op safety on pristine drawer | S6 |

## Regression / smoke

- [ ] Run → refine → **Send N to chart** still plots the emitted set.
- [ ] The `Alive across` row's own × (per-bound clear) still clears just
  the bound.
- [ ] Symbol swap still reseeds fields from that symbol's saved blob
  (do this BEFORE resetting — persistence is per-symbol and Reset deletes it).
- [ ] Chips-panel **Clear all** (#1516) unaffected — chips clear, count
  row disappears.

## Verdict

PASS — all 6 scenarios + refinement pass + regression smoke (user-run UAT, 2026-11-17)

## Results log

- 2026-11-17 — user-run UAT: S1–S6 PASS, refinement checks PASS, regression smoke PASS, no findings.
