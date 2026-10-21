**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** FE Blueprint — RH Scanner Page  
**Thread Slug:** rh-scanner  
**Issue:** #1133  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1141  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

# Code Review — #1141 Compare panel + proposal history + verify relay

**Verdict: PASS** — three axes converged twice. Round 1: one material
Spec finding (relay aborted the catalog loop on the first recipe
failure) + convergent LOWs remediated in-review. Round 2 re-attack on
the post-remediation diff: all R1 fixes verified holding, two
convergent MEDIUMs (duplicate expando ids across co-rendered panels;
WARN block could crash uncaught on the drift it catches) + LOWs
remediated — axes then converged on edge-case nits only. Final:
233/233 focused specs + zero tsc diagnostics on both projects.

Files under review:

- `src/app/features/savant-trader/pages/scanner/scanner-compare-panel.component.{ts,html,scss,spec.ts}` (new — dumb panel: `ComparePanelData` input, bucket expandos + counts, chips → `focusSymbol`, `dropDetail` tooltips, `readOnly`/`title`/`meta` proposal mode, `closed` output)
- `src/app/features/savant-trader/pages/scanner/scanner.component.{ts,html,scss,spec.ts}` (live + reopened-proposal panel wiring, `onFocusSymbol` row focus/scroll, history list, `loadProposals` on init)
- `functions/scripts/verify/rh-scanner-recipes-1098.ts` (new — live `preview_scan` per catalog recipe via `executeObservationTool`)
- `functions/scripts/verify/run-all.ts` + `README.md` (registration)
- IMPL §3/§5 + TEST doc (as-built annotations)

Three axes ran in parallel against the uncommitted diff: Standards
(AGENTS.md conventions, savant-ds/vl mixin + token usage, a11y), Spec
(issue #1141 bullets + IMPL §3/§5 + TEST plan), thermo-nuclear
(contract matrix `CompareResult`/`CurationProposal` → `ComparePanelData`,
focus/scroll races, relay executor semantics, spec quality).

## Findings → remediation

**Spec (material):**

- **Relay aborted on first recipe failure** — `await preview(...)` threw
  outside `check()`, so one failed `preview_scan` killed the catalog
  loop; the issue asks for *every* recipe exercised. → per-recipe
  try/catch: a transport/tool failure logs `FAIL <id>` and the loop
  continues; the summary still exits non-zero on any failure.

**Convergent LOWs (2+ axes) → fixed:**

- `focusedSymbol` never cleared — survived `selectRecipe`/a new run; a
  coincidentally-matching symbol in the next compare would highlight
  unasked, and a pending `setTimeout` could scroll the wrong run's row.
  → `effect` clears `focusedSymbol` on `compare()` change; the
  scheduled scroll re-checks `focusedSymbol()` and drops stale clicks.
  Spec'd (superseding-compare clears `.focused`).

**LOWs → fixed:**

- Relay `k in r.columns` prototype-chain probe → `Object.hasOwn`
  (consistent with the store's presence-probe idiom).
- Relay `res.toolError` unchecked — `success:true` + tool-envelope
  error surfaced as generic "missing data.result" → its text is
  asserted/surfaced first.
- First-ever `functions/scripts → src/app` import — Angular-freeness
  was incidental (all `import type` today) → header comment pins the
  type-only constraint (a future runtime import breaks tsx, not tsc).
- SCSS: `.bucket-drop`/history `.drop` used `var(--mat-sys-error)`
  instead of the direction vocabulary → `vl.$down`; `.bucket-dead`/
  history `.dead` used `--mat-sys-on-warning-container` as a bare
  color (the file's own comment calls it a container-pair foreground)
  → the warning pair now rides the count badge (bg + fg together);
  raw px that map cleanly onto the ds scale swapped to
  `--ds-space-*`/`--ds-radius-sm`.
- Panel `mat-icon-button` rendered without `MatButtonModule` →
  imported.
- a11y: expando heads lacked `aria-controls` → added with per-bucket
  chip-row ids (`aria-expanded` was already present).
- Spec hygiene: `Element.prototype.scrollIntoView` spy leaked on a
  throwing expect → try/finally restore; the store mock re-declared
  `{id; proposal}` inline → `StoredProposal` type import.
- Comment drift: panel doc overstated meta contents; component said
  "scroll next frame" for a `setTimeout` → both corrected.

## Accepted / flagged, not fixed

- ~60-line check/assert/preview harness copied from
  `rh-scanner-contracts-1131.ts` — self-contained scripts are the
  verify-directory convention; a shared harness refactor is out of
  #1141 scope (flag for a future cleanup if a third copy lands).
- Relay filename `-1098` (topic) vs predecessor `-1131` (task) —
  IMPL §5 names it this way; spec-faithful.
- Reopened-proposal chips still emit `focusSymbol` — a coincidentally
  matching live row highlights under a "read-only" banner. Documented
  intent (chips focus "where the symbol exists"), low harm.
- `checkRowShape`'s row-contract check passes vacuously on empty
  `results` — deliberate (empty ≠ failure for losers/52w-low recipes);
  label is accurate ("every row carries …").
- `executeObservationTool` connect-per-call ×10 recipes — matches every
  sibling verify script; `executeObservationToolBatch` exists for
  session reuse if this ever needs to be faster.
- `noDataPred`/`dropDetail`/`unevaluated` semantics inherited from
  #1138/#1139 — verified consistent, not re-reviewed.

## Verified

- 233/233 specs: page 28 + panel 7 (incl. focus-clear, ghost-symbol
  no-op, readOnly close, dedupe, all-clear) + store/compare/recipes/
  nav/routes suites unchanged-green.
- `tsc --noEmit`: zero diagnostics on scanner paths (app) and the
  relay (functions `scripts/verify/*.ts` include).
- Panel is boundary-driven: inputs `data`/`readOnly`/`title`/`meta`,
  outputs `focusSymbol`/`closed`; no store injection — live
  `CompareResult` and persisted `CurationProposal` map onto the same
  `ComparePanelData` shape (`unevaluated` absent on proposals per
  contract; `dropDetail` optional).
- Relay asserts the catalog the page ships (`SCANNER_RECIPES`
  import), production arg shape `{filters, columns}`, contract-shape
  checks, WARN-not-fail column-coverage tripwire, per-recipe failure
  isolation; registered in `run-all.ts` + README.

## Forward notes

- The relay needs the local RH MCP session to execute — registration
  covers CI/manual runs; it could not be exercised in this
  environment (same env as 564/667).
- Shared verify-harness extraction if a third copy of the
  check/assert/preview scaffold lands.

## Round 2 — re-attack on the post-R1 diff

All three axes re-verified the R1 remediations hold (failure isolation,
effect-clear, MatButtonModule, hasOwn probes, token pairs, spec hygiene).
Two convergent MEDIUMs + cheap LOWs found and remediated:

**MEDIUMs (convergent across axes):**

- **Duplicate expando ids when live + proposal panels co-render** —
  `id="bucket-panel-<key>"` collided across the two panel instances
  (invalid HTML, ambiguous `aria-controls`). → per-instance `uid`
  prefix (`panel-N-<key>`).
- **Relay coverage-WARN could crash uncaught on the drift it exists
  to catch** — `Object.hasOwn(r.columns, k)` on `columns: null` or a
  non-array `results` threw OUTSIDE `check()`, hard-crashing the loop
  mid-catalog and skipping the summary — the exact failure-isolation
  contract R1 added. → `Array.isArray` + per-row object guards; the
  WARN block now degrades to "column absent" instead of crashing.

**LOWs → fixed:**

- History badges misused `vl.badge` (`.add` hand-rolled `dir-long`,
  `.drop` overrode only color leaving the primary-container bg,
  `.nodata` had no rule at all) → canonical `dir-long`/`dir-short`/
  `count.muted` variants; `.dead` keeps the warning pair (no canonical
  warning variant exists).
- Dead `#fff3e0`/`#e65100` fallbacks — both tokens are unconditionally
  defined in `styles.scss`; every sibling call site uses them bare.
- `BucketSection.cls` duplicated `'bucket-' + key` → derived in the
  template; `chipTitle` `dropDetail[sym]` prototype-walk → hasOwn
  guard; relay `unknown` args → `ScanFilter[]`/`ScanColumn[]`; dead
  `?? res.redacted` fallback (the raw envelope can never satisfy
  `data.result`) → `res.parsed` only; scroll lookup →
  `querySelector('tr.focused')` (the signal already guards the row).
- Doc overclaims corrected: `proposalOpen` clears at run START (a
  proposal opened mid-run can co-render — still valid data, now noted);
  IMPL §5 records the `functions/lib/src/app/...` emit side-effect.

**Accepted / not fixed:**

- Page spec pokes child-component DOM (`.sym-chip` etc.) — established
  repo precedent; a child stub would isolate more but adds machinery.
- `'Oct 21'` date-pipe assertion is TZ-dependent — repo TZ is fixed;
  sibling precedent exists.
- `.bucket-panel` harness duplication — R1 accepted convention.

**R2 verified:** 35/35 page+panel specs; tsc clean on both projects.
Axes converged — only edge-case LOWs remain (spec-coupling nits,
accepted conventions). Stopping here per the review bound.
