# UAT — SHARED: vendored sync + theme-tokens verify relay

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1224  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1205  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

## Scope

Task #1205 ran the vendor sync so both apps' committed
`vendor/savant-ds/styles/_tokens.scss` copies match `../savant-ds`
package source (SA's was stale-committed on the pre-#1204 contract),
and extended the theme-tokens relay
(`scripts/verify/design-system-theme-tokens-1204.ts`) to assert
vendored parity in BOTH apps. Review remediation hardened the SA
check: SKIP only when the `../av-proxy-api` checkout is absent; a
checkout present but missing the vendored file FAILs.

## Prerequisites

- Repos: `rel-str`, `../savant-ds`, `../av-proxy-api` (SA optional —
  its checks print `SKIPPED` when the checkout is absent).
- `npm install` run in both apps (`node_modules/savant-ds` junctions).
- No credentials, no Firebase, no dev server needed.

## Start instructions

```bash
# from rel-str repo root
npx tsx scripts/verify/design-system-theme-tokens-1204.ts
npm run sync:ds
cd ../av-proxy-api && npm run sync:ds && cd ../rel-str
cd ../savant-ds && node scripts/verify.mjs && cd ../rel-str
npx sass --load-path=node_modules/savant-ds/styles --no-source-map src/styles.scss .devin/tmp/uat-relstr.css
cd ../av-proxy-api
npx sass --load-path=node_modules/savant-ds/styles --no-source-map src/styles.scss .devin/tmp/uat-sa.css
```

## Test scenarios

### S1 — Token relay incl. both-vendor parity (automated)

**Confirms:** AC "verify relay asserts SHARED TEST R1–R5 and passes"
and AC "vendor _tokens.scss byte-identical in both apps to package
source" (CRLF-normalized compare — IDE re-saves are not drift).
**Steps:** `npx tsx scripts/verify/design-system-theme-tokens-1204.ts`
from rel-str root.
**Expected:** every check `OK` (44 token/emission checks + 2 rel-str
vendor + 2 SA vendor when the sibling checkout is present), footer
`=== ALL 46 CHECKS PASSED ===`, exit 0. With `../av-proxy-api` absent:
`SKIPPED` line, footer still passes.
**Result:** ✅ PASS — 46/46, exit 0 (2026-10-22).

### S2 — rel-str sync cleanliness (automated)

**Steps:** `npm run sync:ds` in rel-str.
**Expected:** `(no changes — vendor was already in sync)`.
**Result:** ✅ PASS — "synced 7 file(s) … (no changes — vendor was
already in sync)" (2026-10-22).

### S3 — SA sync cleanliness (automated)

**Steps:** `cd ../av-proxy-api && npm run sync:ds`.
**Expected:** the sync script always rmSync+cpSync's then reports
`git status` of vendor — pre-ship it prints `vendor refreshed —
changes to commit: M vendor/savant-ds/styles/_tokens.scss` because
HEAD still holds the pre-#1204 contract. The meaningful assertion is
content-vs-source, which S1 proves; post-ship re-runs print
`vendor already in sync — nothing changed`.
**Result:** ✅ PASS — reported `M` vs HEAD only; relay (S1) confirms
working-tree content identical to `../savant-ds` (2026-10-22).

### S4 — Both app Sass pipelines compile + tokens emit once (automated)

**Confirms:** AC "_index.scss still forwards tokens; both app Sass
pipelines compile" — real invariant per the impl plan: `_index.scss`
forwards mixins only; `@use 'tokens'` in each global stylesheet emits
the `:root` + `[data-theme=dark]` blocks once.
**Steps:**
```bash
npx sass --load-path=node_modules/savant-ds/styles --no-source-map \
  src/styles.scss .devin/tmp/uat-{app}.css   # in each app
```
**Expected:** exit 0 both apps; emitted CSS contains `--ds-accent:`
twice (one light, one dark) and `[data-theme=dark]` selectors.
**Result:** ✅ PASS — both compile; rel-str `--ds-accent:` count 2 +
dark selectors, SA same (2026-10-22).

### S5 — Mixin index resolves in both apps (automated)

**Steps:** compile a one-line `@use 'index' as ds;` fixture through
each app's `node_modules/savant-ds/styles` load path.
**Expected:** exit 0 — all five mixin-module forwards resolve.
**Result:** ✅ PASS — both apps, exit 0 (2026-10-22).

### S6 — Package verifier still green (automated)

**Confirms:** the savant-ds README correction (docs-only) broke
nothing; the 47-token manifest, literal values, no-mat-sys-alias
guards, and mixin fixture checks all still hold.
**Steps:** `cd ../savant-ds && node scripts/verify.mjs`.
**Expected:** footer `All checks passed.`, exit 0.
**Result:** ✅ PASS (2026-10-22).

### S7 — SA visual sanity (inspection)

**Confirms:** SA renders unchanged under the synced token contract.
**Steps:** grep SA component stylesheets for `var(--ds-` readers.
**Expected/Result:** ✅ PASS — zero `var(--ds-*` consumers in
`src/`; SA's `ds.state-block` mixin reads `--mat-sys-*` (the bridge
in `styles.scss` serves it), so the swapped `--ds-*` literals cannot
alter rendering. An in-app eyeball is a no-op by construction.

## Traceability

| Criterion | Scenario |
|---|---|
| vendor `_tokens.scss` byte-identical in both apps | S1 (vendor checks), S2, S3 |
| relay asserts R1–R5 and passes | S1, S6 |
| `_index.scss` forwards + both pipelines compile | S4, S5 |
| Review MAJOR: missing SA vendor file FAILs not SKIPs | code review R1 remediation; S1 covers present-file path; gate logic read-verified in review round 2 |

## Regression smoke

- [x] theme-tokens relay 46/46 (S1)
- [x] consumption relay design-system-consumption-1039 green (run at review)
- [x] sa-consumption-1042 comment corrected to post-#1204 framing (review R2)
- [x] package verify.mjs green (S6)
- [x] no `--ds-*` readers in SA — visual no-op proven (S7)
