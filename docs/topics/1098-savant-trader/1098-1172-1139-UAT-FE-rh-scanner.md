**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** FE Blueprint — RH Scanner Page  
**Thread Slug:** rh-scanner  
**Issue:** #1133  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1139  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

# UAT — #1139 Scanner service + store

QA issue: #1172. Review doc:
`1098-1133-1139-CODE-REVIEW-FE-rh-scanner.md` (PASS, 2 rounds — HIGH
F1 compare-engine classification bug + MEDIUMs remediated in R1;
R2 re-review found only LOWs, all fixed or documented).

## Scenario results

### 1. Focused suites green — PASS

`npx jest scanner robinhood-mcp-client --coverage=false` (fresh run,
post-R2-remediation): **7/7 suites, 182/182 tests** — compare engine
(23), rows, recipes, service (8), store (16), client incl. the
`onProgress` tick spec (`(20,21)`, `(21,21)` over a 21-chunk universe).
Zoneless-change-detection warnings are the repo-wide known
non-failure.

### 2. `tsc --noEmit` — PASS

Zero diagnostics matching `scanner|robinhood-mcp-client` on the full
root typecheck (pre-existing unrelated diagnostics elsewhere only).

### 3. Semantics vs. issue checklist + IMPL — PASS

| Checklist | Evidence |
|---|---|
| `scanner.service`: runScan/evaluateTracked + proposal CRUD on `st-scanner/proposals/items` + preview_scan-only | `runScan`→`previewScan`; `evaluateTracked`→two `evaluateUniverse` passes (coverage `{...recipe,filters:[]}` then filtered, combined `done/(2·total)` progress); `saveProposal`/`listProposals`/`getProposal` via `authed()` (requireUserId + injection context); drift-tolerant reads (list skips, get → null); no other MCP tool reachable |
| `scanner.store` (signalStore): selection, runScan→discovery+persist, evaluateTracked→prune+progress, openProposal, error+reauth | All present; `requiresReauth` computed on `AUTH`; `canEvaluateTracked` gates prune; `runSeq`/`scanSeq`/`evalSeq`/`proposalSeq` tokens govern supersession; `selectRecipe` supersedes + resets |
| Store spec: run→compare→persist, proposal ordering, superseded cancellation | `runScan → discovery compare → auto-persist` asserts `matchedCount` = wire `totalItems`; prune spec asserts `dropDetail`; ordering via `orderBy('ranAt','desc')` + prepend; supersession spec'd at result-drop, mid-save-prepend, stale-error, and save-rejection levels |

IMPL §Store/§Compare/§gateway re-synced during review (state names,
two-eval signature, drift-tolerant reads, `AUTH`-only categories,
covered∧unevaluated⇒unknown rule).

### 4. Diff footprint — PASS

`git status`: 10 files, all scanner-scoped —

- NEW: `services/scanner.service.{ts,spec.ts}`,
  `stores/scanner.store.{ts,spec.ts}`
- MOD: `robinhood-mcp-client.service.ts` (+`onProgress` param, JSDoc)
  + spec (+1 tick spec)
- MOD: `utils/scanner-compare.util.{ts,spec.ts}` — #1138-file
  remediations (R1-F1 covered∧unevaluated⇒unknown; R2-3
  `matchedBySymbol` noData fallback) — scope-flagged in review
- MOD: FE IMPL doc (semantics re-sync); NEW CODE-REVIEW doc

No user files touched; no unrelated churn.

## Notes carried forward

- `CurationProposal` has no `unevaluated` field — a reopened proposal
  can't distinguish kept from never-screened; #1141 design note.
- `evaluating` progress is effectively binary (one tick per /batch
  group) — #1140 renders spinner + count, not a bar.
- Superseded-mid-`addDoc` ghost-write documented + spec'd (doc written,
  never prepended; reappears on next `loadProposals`).

## Gate resolution

All four scenarios green → **QA gate: PASS**. #1139 is ship-eligible.
