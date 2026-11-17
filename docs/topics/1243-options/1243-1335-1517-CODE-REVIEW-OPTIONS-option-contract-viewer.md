**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1335  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1517  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# CODE-REVIEW — #1517 FE Task: Reset control for the group generator

## Verdict: **PASS** (3 axes in parallel + serial coverage pass; in-round remediations verified)

## Round 1 — three axes (2026-11-17)

### Standards

Essentially clean. One minor, two in-scope nits:

- **MINOR (fixed in-round)** — `.gen-reset` duplicated `.gen-lines-toggle`
  near-verbatim, and the sibling lacked `font-family: inherit` (no global
  button font reset exists — `.plotted-clear-all`/`.chip-main` declare it
  locally per house style). Remediated by merging both into one shared
  selector carrying `font-family: inherit`.
- NIT (fixed) — double blank line introduced at the `.gen-reset` site.
- NIT (noted) — spec file now ~425 lines, over the 400-line smell line;
  spec accumulation, not blocking.
- Pre-existing (out of scope, documented): `.gen-lines-copy` dup selector
  `.dse-icon, .dse-icon`; `icon-btn`s missing `type="button"`.

Verified clean: zero stale `onClear`/`Clear` references; `.ds-btn outline`
still used by `.gen-retry`; comment conventions match; `type="button"` +
tooltip present; new specs follow file conventions (`setup()`/`flush()`/
`text()` helpers, zoneless, issue-ref naming).

### Spec

**PASS — every acceptance criterion met.** Full state enumeration verified
field-by-field:

- Reset covers: `query` (→ `{type:'BOTH'}`), `refine` incl. `aliveRange`
  (→ `{}`), `records`/`status`/`error`/`truncated`/`corpusDates`/
  `lastEmitted`/`hasRun` via `clearResults()`, `openDate`,
  `useRangeAsOpenDate`, `sortLevels` (new), persisted blob
  (`clearGeneratorSettings`), in-flight `run()` invalidation (`runSeq++`),
  component `queryExpiryText`/`refineExpiryText` (reseed) and `showLines`
  (new collapse).
- Correctly retained: `symbol` (page-owned; not a generator field).
- The issue's implementer note was answered as intended: the gap was
  **both** discoverability (button labeled "Clear", nested inside the
  Query section) **and** genuinely escaping state (`sortLevels`,
  `showLines`).
- Outside-drawer consistency verified: chart band (`activeStudyRange`),
  `boundVisible` projection, `brushCorpus`, contract-list-picker "Apply
  range" — all derive from `refine().aliveRange`/`corpusDates` and clear
  correctly.

Findings:

- **MINOR (fixed in-round)** — armed study-range brush survived Reset:
  `brushArmed` lives on the page-level `OptionChartGeneratorService`, so
  a post-reset chart drag would re-write `refine.aliveRange` AND
  re-persist the just-deleted settings blob. Remediated: `onReset()` now
  calls `gen.clearStudyRange()` (disarm + bound clear; the redundant
  `persist()` writes a defaults blob — semantically identical to absent).
- LOW (noted for QA) — Reset is a quiet 10px text button; the original
  QA gap was discoverability, so the UAT should re-verify a user finds it.
- TRIVIAL (fixed) — new DOM spec dirtied only `queryExpiryText`; now
  dirts + asserts `refineExpiryText` too.

### Thermo-nuclear

No critical/major. Probes that came back clean: in-flight `run()` race
(`runSeq++` + symbol guard on both continuations), persisted-blob write
ordering (persist is synchronous inside mutators), blur-commit ordering
(blur commits before click — no uncommitted leak), effect re-seed cycle
(impossible — keyed on `symbol()` only), Angular/OnPush/signal rebind on
focused fields.

Findings:

- MINOR (fixed in-round) — same armed-brush resurrection as Spec axis.
- MINOR (noted) — component-level spec gap for Reset-during-loading
  (store-level coverage exists at `store.spec.ts` "clear() during an
  in-flight run discards the late response"); accepted — the DOM surface
  derives from the same signals the store spec pins.
- NITs (accepted, documented): Reset always-enabled on pristine drawer
  (idempotent, matches Clear-all precedent); destructive-without-confirm
  (house style — `onClearPlotted`, `clearStudyRange`,
  `onClearAllDisplayFilters` all act immediately); spec pokes
  `showLines.set` rather than clicking the toggle (tests collapse-on-reset,
  not the toggle).

### Serial coverage pass

Re-checked the union over the full diff post-remediation: every finding
either fixed-and-reverified or explicitly accepted/documented. One honest
note: `clearStudyRange()`'s `applyRange(null) → persist()` re-writes a
defaults blob after `clear()`'s delete — verified semantically equivalent
(blob contents = defaults; reload yields identical state). No new
findings; converged.

## In-round remediations

| Finding | Fix | Verified |
|---|---|---|
| Armed brush survives Reset → bound + blob resurrection | `onReset()` → `gen.clearStudyRange()`; spec asserts the call | 42/42 |
| `.gen-reset` dup of `.gen-lines-toggle`; sibling missing `font-family: inherit` | shared selector `.gen-lines-toggle, .gen-reset` | visual/style |
| Spec asymmetry (`refineExpiryText` unasserted) | dirt + assert added | 42/42 |
| Double blank line in SCSS | collapsed | — |

One self-inflicted spec bug caught mid-remediation (refine-expiry dirty
filtered all fixtures out) — fixed; final suite green.

## Test results

- `npx jest option-group-generator/ option-group-generator.store.spec.ts
  --runInBand` — **42/42 pass** (2 suites), post-remediation.

## Remaining nits (documented, non-blocking)

- `sortLevels` resets on Reset but not on `setSymbol` — deliberate
  (session view state); QA may sanity-check user expectation.
- Spec file ~425 lines — over the size-smell line; watch on next growth.

Next: `/proj qa 1243 1517`.
