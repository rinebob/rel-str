**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** FE Blueprint — RH Scanner Page  
**Thread Slug:** rh-scanner  
**Issue:** #1133  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1141  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

# UAT — #1141 Compare panel + proposal history + verify relay

QA issue: #1182. Review doc:
`1098-1133-1141-CODE-REVIEW-FE-rh-scanner.md` (PASS, 2 rounds — R1:
1 material Spec + convergent LOWs; R2 re-attack: R1 fixes verified
holding, 2 convergent MEDIUMs + LOWs remediated, axes then converged
on edge-case nits only).

## Scenario results

### 1. Focused suites green — PASS

`npx jest pages/scanner scanner.store scanner-compare scanner/ nav-sections core-routes --coverage=false`
(fresh run, post-R2-remediation): **7/7 suites, 233/233 tests** —
panel (7: non-empty-bucket expandos + counts, unevaluated live-only,
chips→focusSymbol emit, dropDetail tooltip, readOnly title/meta/close,
all-clear, null-data hidden), page additions (loadProposals on init,
live panel render, chip→`.focused`+scroll, focus clears on compare
change, history row + openProposal, read-only detail + closeProposal,
ghost-symbol no-op), plus all #1140 coverage unchanged. Zoneless
NG0914 warnings are the repo-wide known non-failure.

### 2. `tsc --noEmit` — PASS

Zero diagnostics matching `scanner` on the app typecheck; zero on
`rh-scanner` on the functions typecheck (relay compiles under the
`scripts/verify/*.ts` include).

### 3. Semantics vs. issue checklist + IMPL §3/§5 — PASS

| Checklist | Evidence |
|---|---|
| Bucket expandos w/ counts; symbol chips → row focus | One expando per non-empty bucket (Set-deduped, NG0955-safe), `aria-expanded`/`aria-controls` (per-instance `uid` — no collision when live + proposal panels co-render), count badges; chips emit `focusSymbol` → `.focused` class + `scrollIntoView` (compare-gated; ghost symbols no-op — spec'd) |
| Proposal history list (ranAt · recipe · counts) → open read-only | `loadProposals` on init; rows show `ranAt` (date pipe), recipe title w/ id fallback, `dir-long`/`dir-short`/warning/`muted` count badges; `openProposal` → same panel in `readOnly` mode (title/meta/close → `closeProposal`); `dropDetail` → chip tooltips on both modes; `unevaluated` live-only (not persisted per contract) |
| Relay — every recipe via preview_scan on real session; run-all + README | `rh-scanner-recipes-1098.ts` imports `SCANNER_RECIPES` (the catalog the page ships); per-recipe `preview_scan({filters, columns})` — production arg shape — with per-recipe failure isolation; contract-shape asserts + `toolError` surfacing; column-coverage WARN guarded against drifted shapes; registered `run-all.ts` + README row/#39 |
| Component spec for panel + history states | 7 panel specs (setInput-driven, non-vacuous) + 6 page specs for the #1141 surface incl. focus-clear + ghost-symbol edges |

IMPL §3/§5 + TEST doc re-synced during review (shared-panel as-built,
meta wording, relay coverage/drift behavior, functions-lib emit
side-effect, `proposalOpen` clears at run start).

### 4. Diff footprint — PASS

`git status` scoped to #1141:

- NEW: `pages/scanner/scanner-compare-panel.component.{ts,html,scss,spec.ts}`
- MOD: `pages/scanner/scanner.component.{ts,html,scss,spec.ts}`
  (panel wiring, focus/scroll, history section, opened-proposal
  detail, focus-clear effect)
- NEW: `functions/scripts/verify/rh-scanner-recipes-1098.ts`
- MOD: `functions/scripts/verify/{run-all.ts, README.md}`
  (registration)
- MOD: IMPL + TEST docs (as-built re-sync); NEW CODE-REVIEW doc;
  NEW this UAT doc

Heavier unrelated churn elsewhere in the working tree (#1014
order-ticket/st-ids, #1081 analysis work, ds migrations) belongs to
other sessions — stays unstaged at ship, as before.

## Notes carried forward

- The relay cannot be exercised in this environment — it needs the
  local RH MCP session (same env as the 564/667 relays). Registered
  for CI/manual runs.
- Shared check/assert/preview harness is now twice-copied in
  `scripts/verify/` — extraction candidate if a third lands.
- `functions/lib/src/app/...` emit side-effect documented in IMPL §5.
- Mid-run `openProposal` may co-render with a landing compare —
  valid read-only data, per-instance ids prevent a11y collision.
- `CurationProposal.unevaluated` remains absent (contract gap carried
  from #1139).

## Gate resolution

All four scenarios green → **QA gate: PASS**. #1141 is ship-eligible.
