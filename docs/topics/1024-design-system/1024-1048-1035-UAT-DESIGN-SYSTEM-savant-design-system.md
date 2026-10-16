**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** design-system-foundation  
**Issue:** #1048  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1035  
**Domain:** SHARED  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# UAT — #1035 Token layer `_tokens.scss` (`--ds-*` + dark theme)

**Verdict: PASS**

Refinement: N/A — no UI surface (SCSS infrastructure only).

## Acceptance criteria

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| AC1 | `_tokens.scss` emits all documented token names under `:root` | PASS | `npm run verify` — 25 manifest tokens set-equal with compiled `:root` block, both directions |
| AC2 | `[data-theme="dark"]` overrides present, `_variables-global.scss` convention | PASS | Dark block emits `--ds-shadow-1`/`--ds-shadow-2` deeper-alpha overrides; verified ⊆ root set |
| AC3 | Material-mirroring tokens alias `var(--mat-sys-*)` | PASS | All 5 mirrors asserted individually: surface, on-surface, surface-variant, error, border-subtle→outline-variant |

## Scenarios executed (live evidence, 2026-10-16)

- **S1 — package verify** (`npm run verify` in savant-ds): **86/86 checks OK** — compile, set-equality, 20 literal values exact-match, 2 dark values exact-match, 5 alias bindings, `loadPaths` consumer resolution.
- **S2 — rel-str relay** (`npx tsx scripts/verify/design-system-tokens-1035.ts`): **PASS** — mirrors the package verifier behind the `needsPath: '../savant-ds'` gate.
- **S3 — emission contract (negative):** `sass.compileString("@use 'index'")` via loadPaths emits **empty CSS** — component-scoped `@use 'index' as ds` cannot leak `:root` tokens into component chunks.
- **S4 — drift detection (negative):** doctored `--ds-up: #00ff00` vs expected `#4caf50` → comparison **fails**; doctored `--ds-space-1: 999px` → **fails**. Checks are not vacuous.
- **S5 — boundary:** dark block contains only the 2 documented shadow overrides — no P&L/geometry duplication (TEST edge case).

## Findings

None. Review remediation (emission contract, set-equality, per-alias, value pins) is fully covered by executable checks — no unexamined acceptance criteria.

## Result

QA PASS. Task #1035 is ship-eligible.
