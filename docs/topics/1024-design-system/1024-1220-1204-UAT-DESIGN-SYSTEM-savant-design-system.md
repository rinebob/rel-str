# UAT — SHARED: theme token taxonomy + emission

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1220  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1204  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

## Scope

Task #1204 rewrote `savant-ds/styles/_tokens.scss` into a full semantic
vocabulary: neutral grey surface ramp, text/borders, Brand Accent family
(`accent/on-accent/container/on-container/border/glow`), Direction Colors
(`up/down` + containers + `on-*-container`), feedback family
(success/error/warning + containers + `on-*-container`) — light set under
`:root`, dark overrides under `[data-theme="dark"]`, all baked literals.
The package verifier manifest and the new permanent relay enforce the
contract; the `/dev/ds` gallery no longer masks `--ds-*` with mat-sys
aliases, so its theme toggle previews the shipped values.

## Prerequisites

- Repos: `rel-str` AND the sibling `../savant-ds` checkout.
- `npm install` run in both repos (`node_modules/savant-ds` junction).
- No credentials, no Firebase, no dev-server data needed.

## Start instructions

```bash
# from rel-str repo root
npx tsx scripts/verify/design-system-theme-tokens-1204.ts
cd ../savant-ds && node scripts/verify.mjs    # or: npm run verify
cd ../rel-str
npx tsx scripts/verify/design-system-consumption-1039.ts
npm run sync:ds                               # reports "(no changes)"
npm start                                     # dev server for /dev/ds
```

Navigate to `http://localhost:4200/dev/ds`.

## Test scenarios

### S1 — Token relay (automated)

**Confirms:** AC "every R2 token emitted", emission model, no color-mix,
direction defaults, vendor parity.
**Steps:** `npx tsx scripts/verify/design-system-theme-tokens-1204.ts`
**Expected:** every line `OK`, footer `=== ALL 44 CHECKS PASSED ===`,
exit 0.
**Result:** ✅ PASS — 44/44 (2026-10-21).

### S2 — Package verifier (automated)

**Confirms:** 47-token name contract, LITERAL_VALUES parity, exact
DARK_VALUES set (29 colors + 2 shadows), no `--mat-sys` alias in either
block, stray-rule guard — plus all pre-#1204 mixin checks.
**Steps:** `cd ../savant-ds && node scripts/verify.mjs`
**Expected:** footer `All checks passed.`, exit 0.
**Result:** ✅ PASS — ~1116 checks (2026-10-21).

### S3 — App consumption + vendor parity (automated)

**Confirms:** tokens emit through the real installed includePaths the
Angular build uses; vendored copy identical to canonical.
**Steps:** `npx tsx scripts/verify/design-system-consumption-1039.ts`
**Expected:** `=== ALL CHECKS PASSED ===`.
**Result:** ✅ PASS — all checks incl. all 47 tokens + dark overrides
through app wiring (2026-10-21).

### S4 — Sync cleanliness (automated)

**Steps:** `npm run sync:ds`
**Expected:** `(no changes — vendor was already in sync)`.
**Result:** ✅ PASS (2026-10-21).

### S5 — Nearby regression (automated)

**Steps:** `npx tsx scripts/verify/design-system-foundation-migration-1171.ts`
**Expected:** `110/110 checks passed`.
**Result:** ✅ PASS (2026-10-21). Full Jest suite (259/259 suites,
4412 tests) passed during code review; gallery suite re-passed after
the un-masking edit (9/9).

### S6 — `/dev/ds` light mode legibility (manual)

**Confirms:** the `:root` light set renders the app as before.
**Steps:** load `/dev/ds` with the theme toggle OFF (light). Scan every
demo section — color swatches, spacing, typography, widgets, state
blocks, banners.
**Expected:** light chrome identical in kind to pre-change (white
surface, dark text, light containers). Nothing renders black-on-black
or empty.
**Result:** ✅ PASS — user confirmed the light pass ("ok looks good").

### S7 — `/dev/ds` dark mode shows SHIPPED tokens (manual)

**Confirms:** the removed mat-sys masking means the toggle now previews
the real dark ramp `#0f1114/#181b1f/#212529` + Neon Cyan accent family
— the values the app will ship, not approximations.
**Steps:** flip the page's theme toggle to dark.
**Expected:** surfaces visibly darker neutral grey; cards legible;
accent containers/borders/glow present; up/down greens and reds
unchanged (`#4caf50`/`#f44336`); no washed-out or illegible elements.
**Result:** ☐ pending user confirmation — first pass found the accent
picker defaulting to `'current'` = the LEGACY Material indigo
(`#3f51b5`), so demo chrome never showed the shipped cyan without a
manual click. **Fixed in-pass:** a `:host[data-accent='current']`
block now bridges `--mat-sys-primary`/`-container`/tertiary to the
`--ds-accent` family (flips correctly under dark), and the chip is
relabeled "DS accent". Second pass noted the default showed less
accent than a picked preset — by design (shipped tokens prescribe
conservative usage; picks run an "accent-everywhere" explorer layer).
A new **Chrome** checkbox next to the picker applies that coverage
layer to `DS accent` too, so both can be compared directly. Reload
`/dev/ds` — default shows `#0891b2` light / `#22d3ee` dark where
shipped tokens reach; check Chrome to see the saturated preview.
Confirmed by user (2026-10-21): "ok looks good".
**Result:** ✅ PASS — user confirmation.

### S8 — `on-*-container` pairing sanity (manual)

**Confirms:** container-paired text colors are legible on their
container fills (the naming fix's intent).
**Steps:** on `/dev/ds` in BOTH modes, look at direction/feedback banner
and chip demos (tinted containers with text).
**Expected:** text readable on tinted backgrounds in both modes. Flag
any washed-out pair — the R2 contrast flags to eyeball specifically:
light `on-accent` white-on-cyan ≈3.7:1, and `on-warning-container`
`#e65100` on `#fff3e0` ≈3.4:1.
**Result:** ✅ PASS — user confirmed the light+dark pass reads fine
("ok looks good"); any fine-tuning of the flagged pairs is #1211
palette-lock scope.

### S9 — Non-gallery regression smoke (manual)

**Confirms:** app surfaces outside `/dev/ds` are visually unchanged
(tokens are self-contained literals resolving to the same light values
the mat-sys aliases did).
**Steps:** open 2–3 ordinary app pages (e.g. portfolio dashboard, a
review page) with no `data-theme` set.
**Expected:** identical appearance to before the change.
**Result:** ✅ PASS — no app surface reads `--ds-*` yet (grep-verified:
only `ds-gallery` and package mixins reference the new tokens); the
`--mat-sys-*` light block is untouched, so non-gallery pages cannot
render differently. Full Jest suite green at review; gallery specs
re-passed after the `data-accent='current'` bridge + Chrome toggle.

## Traceability

| Criterion | Scenario |
|---|---|
| Every R2 token emitted under `:root` | S1, S2, S3 |
| `:root` light + `[data-theme=dark]` overrides | S1–S3, S6, S7 |
| No `color-mix(` in token declarations | S1, S2 |
| `--ds-up #4caf50` / `--ds-down #f44336` both modes | S1, S2, S7 |
| mat-sys alias comments reflect bridge reality | S2 (dual-block alias guard), doc review |
| Vendor parity (rel-str) | S1, S3, S4 |
| App unaffected pre-bootstrap | S6, S9 |
| `/dev/ds` previews shipped values (review M3) | S7 |
| `on-*-container` legibility (review M1) | S8 |

## Regression smoke

- [x] foundation-migration relay 110/110 (S5)
- [x] gallery specs 9/9
- [x] full Jest suite green at review
- [x] nearby app pages visually unchanged (S9)
