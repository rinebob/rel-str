**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1201  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1205  
**Domain:** DESIGN-SYSTEM  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# CODE-REVIEW — #1205 SHARED: vendored sync + theme-tokens verify relay

## Verdict

**PASS** — two remediation rounds. Round 1: one MAJOR found by two axes
independently (SKIP gated on the vendored file, not the checkout).
Round 2 re-ran all three axes on the post-remediation diff: **all three
PASS** — the fix is verified sound and converged on nits only. Relay
re-run after all fixes: **46/46**. The jest suite carries 11 failures,
**all in the user's in-flight #1017/#1189/#1190 order-ticket WIP —
none reachable from this diff** (details below).

## Round 2 — re-attack of the post-remediation diff

All three axes re-verified the R1 fixes hold and found no new
CRITICAL/MAJOR/MINOR. Key verifications: SKIP/FAIL semantics match the
comment, guide, and README exactly; `vendor/savant-ds` is committed
repo state in SA (a present checkout missing the file is genuinely
abnormal → FAIL is correct, not a false alarm); the 46-check arithmetic
reconstructs exactly (44 baseline + SA compare + SA exists-check);
README corrections contradict no other topic doc.

**Nits converged on (all fixed):**

- `normalize` lacked the CRLF rationale comment the doc claimed —
  added inline ("IDE CRLF re-saves are not drift", same convention as
  sa-consumption-1042).
- Check labels dropped the `styles/` segment and weren't app-prefixed
  — now `rel-str vendor/savant-ds/styles/_tokens.scss exists` /
  `av-proxy-api vendor/savant-ds/styles/_tokens.scss exists`.
- Header doc omitted the `node_modules/savant-ds` early-SKIP gate —
  added.
- "indigo-pink emits none" → "emits no usable values" (the prebuilt
  theme contains one `initial` declaration — airtight phrasing).
- `design-system-sa-consumption-1042.ts` header still framed the bridge
  as "the DS alias contract" — corrected (mixins read mat-sys post-#1204,
  tokens do not).
- Guide "every line prints OK" → "every check prints OK (optional
  sibling checks may print SKIPPED)".

**Accepted bounds (recorded, no action):**

- SA checkout on a pre-vendoring branch FAILs — defensible; vendoring
  is committed mainline state, the FAIL names the missing file.
- `SA_ROOT` exists but isn't a real checkout → FAIL — pathological-env
  case, self-describing; deeper checkout-validation is over-hardening
  for a diagnostics script (scope discipline).
- Mid-file `SKIPPED` + "ALL PASSED" footer — novel output shape but
  semantically consistent (skip ≠ check); `run-all` consumes exit codes
  only.
- `readFileSync` throwing on unreadable vendored path → uncaught
  exception instead of a FAIL line — identical exposure in the rel-str
  half; consistent.
- UAT doc for #1204 records "44 checks" — historical completed doc;
  the footer now reads 46 when `../av-proxy-api` is present.

## Scope

Working-tree diff at review time:

- `scripts/verify/design-system-theme-tokens-1204.ts` — section 6 gains a
  second consumer byte-compare of `../av-proxy-api/vendor/savant-ds/
  styles/_tokens.scss` (TEST-SHARED R5 names both apps).
- `scripts/verify/design-system-theme-tokens-1204.md` — guide updated.
- `scripts/verify/README.md` — #1204 row updated.
- `av-proxy-api/vendor/savant-ds/styles/_tokens.scss` — `npm run sync:ds`
  output; byte-identical to `../savant-ds` source (verified).
- `av-proxy-api/src/styles.scss` — comment-only correction.
- `savant-ds/README.md` — stale pre-#1204 alias-model claims corrected
  (Spec-axis finding, folded in during remediation).

## Round 1 findings → dispositions

### Standards — initially FAIL, remediated

- **MAJOR — SKIP gated on the file, not the checkout**
  (`design-system-theme-tokens-1204.ts`): `existsSync(SA_VENDOR_TOKENS)`
  conflated "sibling checkout absent" (legitimate SKIP) with "checkout
  present but vendored file missing" (real drift — must FAIL). The
  rel-str half correctly FAILs on a missing file. **Fixed:** SKIP now
  gates on `existsSync(../av-proxy-api)`; a missing vendored file inside
  a present checkout emits a FAIL check, mirroring the rel-str half.
- **NIT — `SKIP` vs the toolchain's `SKIPPED`** — **fixed** (consistent
  token; guide + README updated to match).
- **NIT — "byte-for-byte" comment vs `\r\n`-normalized compare** —
  **fixed**: comment now says content-identical; normalization rationale
  documented (`IDE CRLF re-saves are not drift`, same convention as
  `design-system-sa-consumption-1042.ts`).
- Path resolution, check() conventions, comment accuracy, doc parity —
  verified clean.

### Spec — PASS

All three ACs met with evidence:

1. `vendor/.../_tokens.scss` byte-identical in both apps to package
   source — md5-identical across all five copies (source, both vendors,
   both `node_modules` — which are symlinks to vendor and cannot drift).
2. Relay asserts R1–R5 — mapped: compile through installed includePaths
   (R1), exact 47-token `:root` set-equality (R2), `:root` +
   `[data-theme=dark]` selectors with exact dark set (R3), no
   `color-mix(` (R4), both vendored copies (R5).
3. `_index.scss` "still forwards tokens" — **evaluated under the TEST
   doc's corrected invariant:** `_index` never forwarded tokens *by
   design* (a component-scoped `@use` would re-emit `:root` CSS as dead
   CSS into every chunk). Verified the real invariant: `@use 'index'`
   resolves cleanly in both apps and `@use 'tokens'` emits once from
   each app's global `styles.scss`; both `npx sass` compiles pass.
- **LOW — `savant-ds/README.md` pre-#1204 drift** — **fixed**: the
  README claimed tokens alias `--mat-sys-*`, mandated a Material theme
  "or the mirrored tokens resolve to nothing," showed `file:../savant-ds`
  (apps actually use `file:vendor/savant-ds`), and described verify as
  asserting aliasing (it now asserts the opposite). All four corrected.

### Thermo-nuclear — initially FAIL, remediated

- **MAJOR — same file-vs-checkout SKIP defect** (independent find) —
  fixed as above.
- **MINOR — SA `styles.scss` comment understated the bridge** —
  **fixed**: the `--mat-sys-*` block is load-bearing TODAY, not just
  legacy — vendored DS mixins still read it (`ds.state-block` reads
  `--mat-sys-on-surface-variant`; SA's `bz-no-results` consumes it, and
  the prebuilt indigo-pink theme emits no sys vars). Comment corrected.
- **MINOR — hardcoded `av-proxy-api` sibling name rots silently on
  rename** — **accepted bound**: same convention as every DS relay and
  `run-all.ts`'s `needsPath` gates; SA's `file:vendor/savant-ds` dep is
  self-relative so discovery is impossible anyway.
- **MINOR — CRLF normalization vs "byte-identical" wording** — **accepted
  bound** (documented convention across the DS relays; BOM, trailing
  whitespace, and missing-final-newline diffs still FAIL correctly).
- **INFO — `_tokens.scss`-only scope** — **accepted bound**: SA's whole
  `vendor/savant-ds/styles` tree is already covered by
  `design-system-sa-consumption-1042.ts` (filename-set + content parity);
  #1112 byte-compares `_widgets.scss`/`_index.scss`. No coverage gap.

## Test results

- **Relay:** `design-system-theme-tokens-1204.ts` — **46/46 PASS**
  (the checkout/file split added a check).
- **Consumption:** `design-system-consumption-1039.ts` — ALL PASS.
- **Both app Sass pipelines** compile through their real angular
  includePaths; `@use 'index'` resolves in both.
- **Jest:** 4299 passed / **11 failed** — all four failing suites are in
  the user's in-flight order work (#1017 r2 / #1189 / #1190), unrelated
  to this diff:
  - `signal-review.facade.spec.ts` — mocks lack the new
    `stagingStore.loadTickets` call; new #1017 r1 specs mid-edit.
  - `option-order-ticket.component.spec.ts`,
    `gallery-ticket-dialog.component.spec.ts`, `order.component.spec.ts`
    — same WIP surface.
  - `scripts/verify/` is not jest-discovered; nothing in this diff is
    reachable by the failing suites. These reds belong to the WIP tasks'
    own gates, not this one.

## Run note (pre-existing, not this diff)

`scripts/verify/run-all.ts` hung with zero output for 12+ minutes during
verification (a credential/path-gated child or `npx` spawn blocks on this
machine). The design-system relays pass standalone; flagged as a
candidate `BUG:` under Blueprint #1201 — the runner problem predates
this change (the new check adds one `existsSync` + two `readFileSync`).
