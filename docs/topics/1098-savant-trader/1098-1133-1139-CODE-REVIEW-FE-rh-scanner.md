**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** FE Blueprint — RH Scanner Page  
**Thread Slug:** rh-scanner  
**Issue:** #1133  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1139  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

# Code Review — #1139 Scanner service + store

**Verdict: PASS** — two rounds: R1 remediated one HIGH + four MEDIUMs;
R2 re-attacked the post-remediation state and found only LOWs (all
fixed or documented). Re-verified 182/182 scanner+client specs + zero
tsc diagnostics on touched files.

Files under review:

- `src/app/features/savant-trader/services/scanner.service.ts` (new)
- `src/app/features/savant-trader/services/scanner.service.spec.ts` (new)
- `src/app/features/savant-trader/stores/scanner.store.ts` (new)
- `src/app/features/savant-trader/stores/scanner.store.spec.ts` (new)
- `src/app/core/robinhood-mcp/robinhood-mcp-client.service.ts` (additive `onProgress` param)
- `src/app/features/savant-trader/utils/scanner-compare.util.ts` + `.spec.ts` (F1 remediation — #1138 file)
- `src/app/core/robinhood-mcp/robinhood-mcp-client.service.spec.ts` (+1 spec)

Three axes ran in parallel against the uncommitted diff: Standards,
Spec-fidelity (issue #1139 checklist + IMPL §Scanner gateway/§Store +
PRD ACs), and adversarial correctness (token interleavings, progress
math, Firestore seam). Remediations below; re-verified 177/177
scanner+client specs + zero tsc diagnostics on scanner files.

## Remediated

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | HIGH (thermo) | `comparePrune` dropped a covered tracked symbol whose **matched** chunk rejected — union membership meant "unscreened", not "failed", yet it landed in `dropCandidates` with fabricated `dropDetail` (and the surfaced `unevaluated` filter excluded it — invisible anywhere but as a drop). A routine production state whenever any matched chunk rejects. | `dropCandidates` now requires `¬unevaluated`; covered ∧ matched-chunk-failed symbols surface on `unevaluated` (screen verdict unknown). Prior "coverage evidence wins" spec corrected — it encoded the wrong outcome; new spec pins unknown-not-drop + noData-still-wins ordering. |
| F2 | MEDIUM (all axes) | `listProposals` let one drifted doc reject the whole history list while `getProposal` tolerated drift — inconsistent policy. | Drifted docs skipped per-doc in `listProposals`; header documents tolerance on both read paths; spec added. |
| F3 | MEDIUM (spec+thermo) | `loadTrackedSymbols` resolves `[]` on failure → `runScan` proceeded on a phantom empty universe — every row an addCandidate, `universeSize:0` proposal persisted. | `runScan` errors `'tracked universe is empty'` (same as prune path); spec added. Caveat: load-failure vs. genuinely-empty is indistinguishable upstream — documented. |
| F4 | MEDIUM (spec+thermo) | Ghost-write: `saveProposal` fired before the staleness check — a run superseded mid-save wrote a Firestore doc dropped from state. | `persist` token-checks before save AND before the local prepend; save-failure catch token-guarded. Mid-save supersession still writes (can't unwrite) but no longer prepends — spec'd. |
| F5 | MEDIUM (spec+thermo) | `openProposal` unordered last-write-wins race — a slow uncached fetch could clobber a newer open or re-open over a fresh run. | `proposalSeq` guards the async patch; absent/drifted doc surfaces `'proposal not found'` instead of silent null. |
| F6 | MEDIUM (standards+thermo) | Persist failure masqueraded as run failure — compare displayed + generic error banner; `requiresReauth` could never fire for Firebase-side auth errors (by design, but undocumented). | Save failure patches `proposal save failed — …` while the compare stays; `toError` comment documents RH-only categories. Spec added. |
| F7 | LOW | `matchedCount` inconsistent/lossy — discovery used parsed row count (200 under truncation, not the wire's 393); prune used raw wire count. | Discovery now persists `result.totalItems` (truthful under truncation); spec added. |
| F8 | LOW | `selectRecipe` mid-run: in-flight run's results landed under the new selection; stale compare/error persisted across switches. | `selectRecipe` bumps `runSeq` (supersedes) and clears rows/compare/proposalOpen/error. |
| F9 | LOW | `evaluateTracked` guard (`!noDataPred`) weaker than `canEvaluateTracked` (`supportsPrune && noDataPred`) — unreachable today but divergent. | Guard aligned to both predicates. |
| F10 | LOW | Progress wiring unspec'd — the `onProgress`→`patch({evaluating})` path had no store spec; client `onProgress` unspec'd. | Store spec (cb invoked → `evaluating` observed → cleared) + client spec (`(20,21)`, `(21,21)` ticks over 21 chunks). |
| F11 | LOW (docs) | IMPL naming drift — `evaluatingUniverse`/`chunksDone/chunksTotal` vs impl `evaluating`/`done`/`total`; undocumented `proposalsLoading`/`busy`; prune semantics missing matched-chunk-unevaluated case. | IMPL §Store rewritten; §Compare updated with the covered∧unevaluated⇒unknown rule. |
| F12 | LOW (hygiene) | `ScannerState` unexported (siblings export); split `@angular/core`/`@st/scanner`/service imports; dead `QUALITY` const + misleading test title + unused `getDocs` import + unreset `mockGetDoc` fixture + vacuous-adjacent `matchedRecipe` identity assertion; `onProgress` undocumented in client JSDoc. | All fixed. |

## Round 2 (post-remediation re-review)

All three axes re-ran on the remediated diff. No BLOCKER/HIGH — the
R1 fixes verified correct (full comparePrune truth-table trace, token
matrix re-walk, spec non-vacuity confirmed). Remaining findings:

| # | Severity | Finding | Fix |
|---|---|---|---|
| R2-1 | LOW (spec+standards convergent) | `proposalSeq` guarded opens only against opens — `closeProposal`/`selectRecipe`/run starts cleared `proposalOpen` without invalidating a pending `getProposal` (the second half of R1-F5's text was still unfixed) | `++proposalSeq` in `closeProposal`, `selectRecipe`, `runScan`, `evaluateTracked`; specs: last-write-wins by call order + close-invalidation |
| R2-2 | LOW | `loadProposals` wholesale-replace could clobber/dup a `persist` prepend landing mid-fetch | Dedupe-by-id on the list patch |
| R2-3 | LOW | `noDataPred` unreachable for a matched-only symbol (coverage chunk rejected, matched fulfilled) — a blank-metric passer kept silently | `matchedBySymbol` fallback for the predicate row; spec added |
| R2-4 | LOW | Same-id `selectRecipe` superseded + wiped results; run starts left the sibling busy flag stale until the superseded run settled | Same-id early return; `selectRecipe` clears `running`/`evaluating`; each run clears the sibling flag at start |
| R2-5 | LOW | `loadProposals`/`openProposal` never cleared `error` (sibling-store convention does) | `error: null` on both entry/success patches |
| R2-6 | LOW | Spec/doc drift: `authed()` unauthenticated path unspec'd; IMPL §gateway stale (signature, `docData`/`collectionData` names, missing methods, phantom `SESSION` category, stale `unevaluated` comment) | Unauth-reject spec added; IMPL corrected; `persist` pre-save guard commented as defensive |

Accepted, not fixed: **`CurationProposal` has no `unevaluated` field** —
a reopened proposal can't distinguish verified-keeps from
never-screened symbols (`universeSize` counts both). Extending the
shared contract is #1131 territory; flagged as a #1141 history-panel
design note. Ghost-write still possible when supersession lands
mid-`addDoc` (can't unwrite; documented + spec'd).

## Accepted / documented, not fixed

- **Progress granularity is one tick per /batch group** — a ~900-symbol
  universe is a single group, so `evaluating` renders ≈0/0 → done.
  Per-chunk progress is architecturally impossible over one `/batch`
  HTTP call; the UX consequence (binary progress) is a #1140 design
  note, documented in the client JSDoc.
- **In-flight busy flags on superseded runs** — a stale run's `running`
  stays true until its promise settles (its result is guaranteed
  dropped); correct per flag semantics, noted.
- **`toError` maps only RobinhoodMcpError categories** — Firebase auth
  failures surface `category: null` deliberately (a Firebase lapse must
  not trigger the RH re-auth prompt); documented.
- **Prune `truncated: false`** holds by construction (≤150-symbol scope
  ≤150 rows < 200 cap, assuming one row per scoped symbol — flagged
  for a #1141 live-probe sanity check).

## Spec-fidelity summary

- All three #1139 checklist items: implemented + spec'd.
- Non-vacuous coverage of: run→compare→persist both directions,
  two-eval ordering + combined progress, unevaluated union, superseded
  result/error/save-prepend suppression, AUTH→requiresReauth,
  cache-first/fallback openProposal, drift tolerance both read paths,
  empty-universe guard, matchedCount-under-truncation.
- PRD ACs satisfiable: #5/#18/#19 (auto-persist, history, reopen).

## Forward notes

- **#1141 relay** should assert: dropDetail values non-blank for a drop
  candidate (coverage eval populated), `unevaluated` semantics under a
  forced chunk rejection, and whether a scoped call can return >1 row
  per symbol (would weaken prune's `truncated:false`).
- **#1140 page** should treat `evaluating` as binary progress
  (spinner + chunk count, not a bar).
- The #1138-file edit (compare util + spec) is scope-flagged: the F1
  defect lived in the shipped compare engine; fixing in-place beats
  shipping a store that can't express the contract.
