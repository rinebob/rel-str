**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** FE Blueprint — RH Scanner Page  
**Thread Slug:** rh-scanner  
**Issue:** #1133  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1140  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

# Code Review — #1140 Scanner page (route, picker, results table)

**Verdict: PASS** — three axes converged twice. Round 1: three
MEDIUMs + six LOWs remediated in-review. Round 2 re-attack on the
post-remediation diff: all R1 fixes verified holding, zero new
MEDIUM/HIGH, six LOWs remediated. Final: 219/219 specs across the
scanner, store, compare, recipes, nav, and routes suites + zero tsc
diagnostics on touched files.

Files under review:

- `src/app/features/savant-trader/pages/scanner/scanner.component.ts` (new)
- `src/app/features/savant-trader/pages/scanner/scanner.component.html` (new)
- `src/app/features/savant-trader/pages/scanner/scanner.component.scss` (new)
- `src/app/features/savant-trader/pages/scanner/scanner.component.spec.ts` (new)
- `src/app/core/common/interfaces.ts` (`AppRoutes.SCANNER`)
- `src/app/core/common/constants.ts` (PAGE_INFO + nav item)
- `src/app/core/core-routes.ts` + `core-routes.spec.ts` (lazy route + authGuard pin)
- `src/app/core/common/nav-sections.spec.ts` (Trading order + single-entry pin)
- `src/app/features/savant-trader/stores/scanner.store.ts` + `.spec.ts` (`matchedCount`, `runKind`, `columnLookup` state — #1139 file, additive)
- `src/app/features/savant-trader/scanner/scanner-recipes.ts` + `.spec.ts` (`percentColumns`, widened `noDataPred`)
- `src/app/features/savant-trader/utils/scanner-rows.util.ts` (`buildColumnLookup` readonly widening)
- `src/app/features/savant-trader/utils/scanner-compare.util.ts` + `.spec.ts` (`noDataPred` lookup param — #1138 file, additive)

Three axes ran in parallel against the uncommitted diff: Standards
(sibling-page + spec conventions, savant-ds mixin usage, a11y),
Spec-fidelity (issue #1140 checklist + IMPL §Page + TEST coverage),
and thermo-nuclear adversarial correctness (lookup merge semantics,
signal races, status-line truthfulness).

## Remediated

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | MEDIUM | **`mergeLookup` flatten let a bad echo clobber the verified static key.** `new Map([...static, ...dynamic])` gave the echo unconditional win — a `filter_type` echo carrying a filter's *display_title* (dep-prev-scan-04 shape, never a row key) would replace `'ROE'→'Return on equity'` with `'ROE'→'ROE ≥ 15%'`, blanking the whole column and degenerating the sort. | Presence-verified merge: candidates `[echo, static, raw]` — first key any returned row actually carries wins; static wins over an unverifiable echo. Spec: display-title echo can't clobber the static mapping. |
| F2 | MEDIUM | **Prune status line read "150 shown of 12 matched"** — `displayRows` under prune is coverage∪matched (outnumbers the matched count); "shown of matched" is self-contradictory. | New `runKind` state (`'scan' \| 'eval'`) patched with each compare; status line renders `N rows · M matched` for prune runs (R2 refined the label — see R2-N5). Spec'd. |
| F3 | MEDIUM | **`noDataPred` resolved via the static lookup** — under canonicalization drift the table (merged lookup) and the bucketing predicate would read different keys and disagree. | `noDataPred(row, lookup?)` — `comparePrune` forwards a new `columnLookup` arg; the store builds the merged map over coverage∪matched *before* comparing and passes it to both the engine and the page. `qualityNoData` defaults to `QUALITY_LOOKUP` when unpassed. Forwarding spec'd. |
| F4 | LOW | `@for … track row.symbol` hard-errors (NG0955) on a duplicated wire ticker — `compareDiscovery` stamps without deduping. | `displayRows` dedupes by symbol first. |
| F5 | LOW | Failed re-run leaves the prior run's table + status line under the error banner. | **Accepted** — preserves last-good data under a clear error; the error banner itself marks staleness. Documented. |
| F6 | LOW | `SymbolListStore.loadTrackedSymbols` can hang forever if `getTrackedSymbols$()` never emits (no timeout; MCP calls have one). | **Accepted, out of scope** — pre-existing #553 store; flagged for its own task. |
| F7 | LOW | Whitespace-only cells rendered blank (numeric path trims → `—`); progress label said "batches" but counts chunks. | Raw branch trims → `—`; label now "chunks". |
| S1–S6 | LOW | Standards: `th` missing `scope="col"`; warning-token foreground without its container bg; `as never` on a `selectionChange` emit; import grouping drift; untyped `signal(null)`; a spec line implying causality that doesn't exist. | All fixed (scope attrs, container pair bg+padding, `{value, source}` emit, merged imports, `ScannerError` typing, dropped the misleading `running.set`). |

## Round 2 — re-attack on the post-remediation diff

All three axes re-ran; every R1 fix verified holding under re-attack
(mergeLookup presence-verification incl. the title-echo spec's
norm-matching trace; runKind patched atomically with compare; the
same merged map reaches the engine and the page; dedupe precedes
`track`; trim+placeholder holds). Zero new MEDIUM/HIGH — six LOWs,
all remediated:

| # | Finding | Fix |
|---|---|---|
| R2-1 | `mergeLookup` presence probe used `k in r.values` — hits the prototype chain (`'constructor'` echo would false-positive as present and clobber the static key). | `Object.hasOwn(r.values, k)` (repo idiom). |
| R2-2 | `columnValue` raw branch called `.trim()` assuming a string — a drifted non-string wire cell (number/bool) would throw during template eval and fail the whole table render. | Type-guarded: undefined/null → `—`, non-string → `String(v)`, blank → `—`. Spec'd. |
| R2-3 | `displayRows` dedupe was `new Map` last-wins keyed on the raw symbol — a case/whitespace variant pair (`'aapl'`/`'AAPL '`) still rendered duplicate rows, and last-wins disagreed with the compare engine's first-wins `seen` policy. | First-wins dedupe on `trim().toUpperCase()` — same normalization as the engine. Spec'd. |
| R2-4 | Eval `matchedCount` counted raw wire rows while display/buckets dedupe by folded case — `'aapl'`+`'AAPL'` would print `2 rows · 2 matched`→wrong, and over-count persisted `matchedCount`. | `matchedCount` = unique normalized matched symbols; same value feeds the status line and the persisted proposal. |
| R2-5 | `loadProposals` bare-replaced the list — a snapshot taken before an in-flight `persist`'s `addDoc` committed would silently drop the just-prepended proposal until next load. | Merge-by-id: locally-cached entries missing from the snapshot keep their front spots, fetched fills the rest. Spec'd. |
| R2-6 | `openProposal` uncached path didn't clear `error` (cached path did); eval-status label `N evaluated` overstated (dead/chunk-failed symbols were evaluated but produce no row); eval empty state read "filters matched nothing"; truncation text claimed the cap when `isScanTruncated` also fires on a partial page; picker `mat-form-field` was the app's only one missing `appearance="outline"`; `runKind` un-pinned at the store level; IMPL §2 signature sketches + wireframe drifted from as-built. | `error: null` on the fetch patch; label → `N rows · M matched`; empty-state hint branches on `runKind`; cap wording → "doesn't cover all matches"; `appearance="outline"`; `runKind` pinned in both run specs; IMPL/TEST re-synced (signatures, #1140/#1141 split annotated). |

**Accepted / flagged:** a superseded eval still fires its two-eval
batch (no abort mechanism exists anywhere in the client — wasted
/batch calls only, no state harm); `loadTrackedSymbols` no-timeout
carries over from R1's F6 (pre-existing #553 store).

## Spec-fidelity findings (accepted / recorded)

- **AUTH card wording** — IMPL sketched "Robinhood session needs
  reauthorization" + static runbook hint; shipped is the same
  `vpn_key` banner text + a working **Re-authorize** button (the
  signal-order `reauthenticate()` flow). The button supersedes a doc
  pointer — recorded as-built in IMPL §3 rather than reverting.
- **Evaluate tracked button** shipped in #1140 though the compare
  panel/history is #1141's — gated on `canEvaluateTracked`; runs and
  persists correctly; the panel will render the buckets.
- **Cheap spec gaps noted, mostly filled**: Evaluate-button disabled
  assertion (added), `—` empty-cell spec (added), authGuard pin for
  `trading/scanner` (added to the leaf-route `it.each`).
- **`Collection.ST_ORDER_INTENTS` removal rides in `constants.ts`** —
  another session's #1014 path-cutover work (its spec pins the
  removal). Unrelated to #1140; stays **unstaged** at ship.

## Declared deviations from the original IMPL — verified correct

- `matchedCount` state — wire `totalItems` keeps the status line
  truthful under truncation (prune: matched rows).
- `columnLookup` state + presence-verified `mergeLookup` — wires the
  #1136 `buildColumnLookup` (otherwise dead-ended) with the F1 fix.
- `percentColumns` recipe metadata — the catalog's own comments said
  "the display layer applies percentColumn"; guarded to declared
  columns, `sort.column` ⊆ declared columns pinned likewise.
- Client-side `displayRows` sort — the wire pre-cuts Last-desc;
  `recipe.sort` re-sorts within the page (missing metrics sink last).
- Coarse progress label — the store ticks per settled /batch group,
  not per chunk as the IMPL sketched.
- Nav position `…Analysis · Scanner` (IMPL predated Analysis).

## Forward notes for #1141

- Compare panel reads `compare().buckets`/`dropDetail`/`unevaluated`;
  proposal history via `proposals()`/`loadProposals`/`openProposal`
  (already store-exposed).
- `runKind` now distinguishes scan vs eval compares — the panel can
  reuse it for bucket labeling.
- `CurationProposal` still lacks `unevaluated` (carried from #1139
  review) — a reopened proposal can't distinguish kept vs
  never-screened; contract change is #1131 scope if needed.
