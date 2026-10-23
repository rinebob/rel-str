# Code Review — SHARED: theme token taxonomy + emission

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1201  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1204  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

## Summary

Three review axes ran over the #1204 change set
(`savant-ds/styles/_tokens.scss`, `savant-ds/scripts/verify.mjs`,
`vendor/savant-ds/styles/_tokens.scss`, the new
`scripts/verify/design-system-theme-tokens-1204.{ts,md}` relay + guide,
`run-all.ts`/`README.md` registrations, IMPL/TEST doc updates, and the
`ds-gallery.component.scss` un-masking). First pass produced **6 major**
findings — all fixed in this pass — plus minors/nits now resolved or
explicitly deferred. Test suite is fully green.

## Findings by severity

### Major — all fixed

| # | Finding | Disposition |
|---|---|---|
| M1 | `on-*` semantics lied: `--ds-on-up`/`on-down`/`on-{success,error,warning}` carried container-paired values under M3 solid-paired names (illegible if consumed as on-solid, e.g. `#b71c1c` on `#f44336` ≈1.8:1) | **Fixed** — renamed to `on-{x}-container` (M3-exact); naming contract documented in `_tokens.scss` header + IMPL-SHARED. No on-solid tokens added — none consumed yet. |
| M2 | New relay used `css.includes(name)` — substring-masked (a present `--ds-surface-raised` satisfies a missing `--ds-surface`); unscoped to `:root`. The hazard the 1039 relay already documents. | **Fixed** — boundary-exact decl-map parsing per block, `:root` set-equality both directions (47 names), dark-block exact-name-set. |
| M3 | `ds-gallery.component.scss:46-50` redeclared 5 `--ds-*` as `var(--mat-sys-*)` under dark — the `/dev/ds` toggle would have previewed mat-sys approximations, not the shipped ramp (poison for the #1211 palette lock) | **Fixed** — redeclares removed + stale `--ds-error: var(--ds-down)` alias dropped; shipped tokens now preview for real. |
| F2 | FE IMPL Phase 2 + FE TEST R2 still spec'd the rejected `:root`=dark/`[data-theme="light"]` model — literal implementation would emit a bridge that never matches | **Fixed** — both docs now spec `:root` light + `[data-theme="dark"]` dark. |
| F3 | Stale emission-model text inside SHARED docs (IMPL S1 task line, "Existing tokens" section; TEST scope + edge cases) | **Fixed**. |
| F1 | av-proxy-api vendored `_tokens.scss` still the pre-change #1035 file | **Deferred — correct scope.** S2 (#1205) owns the both-apps sync; #1204 is taxonomy+emission. Flagged so it's not lost. |

### Minor — fixed

- `verify.mjs` header described the removed contract (alias assertions,
  shadow-only dark) — rewritten; missing item-7 entry added.
- No-alias guard scanned only `:root` — now scans both blocks.
- `TOKENS` vs `LITERAL_VALUES` could drift — added set-equality check
  (47 names pinned exactly).
- Relay: ambient `sass` resolution → package-pinned via
  `createRequire(DS/package.json)`; missing `node_modules/savant-ds`
  now SKIPs cleanly; dark-selector regex accepts quoted forms; footer
  format aligned to sibling relays.
- `_tokens.scss` header claimed bootstrap "sets it before first paint"
  (F1 doesn't exist yet) and promised non-existent "bake" tooling —
  both corrected; the real manual bake procedure is now written down.
- `--ds-surface-variant` admitted as back-compat debt → annotated
  deprecated, retires in the literal sweep.
- Guide count 39 → corrected (47-token contract); `1035.md` guide's
  stale contract text updated; #1204 issue-body AC updated to the
  shipped model.

### Nits / deferred (recorded, not blocking)

- Neutral ramps are mildly cool-tinted (hue ≈210°, B−R up to +21), not
  strictly channel-equal — matches IMPL-documented hexes; final judgment
  at the `/dev/ds` lock.
- Feedback values identical to direction values — semantic distinction
  is at token-name level (a direction recolor won't drag status).
- Contrast flags for the #1211 visual pass: light `on-accent` on accent
  ≈3.7:1 (borderline); `on-warning-container` ≈3.4:1 — eyeball on the
  page before locking.
- Missing roles for #1163 (hover/state-layers, scrim, focus ring,
  disabled, link, info status) — deliberate deferral: tokens land when a
  consumer needs them, not speculatively.
- Manifests are hand-pinned in two places (`verify.mjs` + relay) — the
  friction is the contract's point; bake procedure now documented.
- `color-mix(` ships in `_widgets.scss` (pre-existing #1108 dir-edge) —
  token-layer criterion met; broad browser-support question already
  deferred to implementation review.
- Emission-model trade: `data-theme="dark"` becomes a permanent opt-in
  for un-bootstrapped hosts (no prefers-color-scheme) — accepted, the
  bootstrap owns the attribute.

## Round 2 — post-remediation re-attack

All three axes re-verified the R1 remediations hold (rename, decl-map
parsing, manifests, un-masking, doc corrections). New findings:

| Finding | Disposition |
|---|---|
| **MEDIUM — `_tokens.scss` header overclaim** ("the `--mat-sys-*` bridge supplies BOTH modes") — the dark bridge doesn't exist; it's F2/#1209's job, and shipping the #1207 bootstrap without it flips DS surfaces while Material stays light. Introduced by the R1 remediation itself. | **Fixed** — comment now states the bridge is light-only pending #1209 and warns against shipping the toggle without it; same sequencing note added to IMPL-FE Phase 2. |
| Relay reintroduced hazards `verify.mjs` guards: no comment stripping, first-match-only `:root`, no stray-rule/at-rule check, non-`--ds-*` decls invisible to set-equality | **Fixed** — ported the `declsOf` full-sheet parse (same-selector concat, all-decl mapping), added the stray-rule + at-rule guard, `/* */` stripping. |
| `expectedDark` substring geometry filter could misclassify a future token name | **Fixed** — explicit `GEOMETRY` list. |
| Stale text family: `styles.scss` "aliases still resolve" rationale; gallery TS blurbs ("alias --mat-sys", "shadows the only dark delta"); gallery scss header citing removed contract text; `1035.ts`/`1035.md`/README rows describing mat-sys aliases as verified-present; `verify.mjs` check-numbering order | **Fixed** — all rewritten to the post-#1204 contract. |
| Gallery accent-preview `--ds-shadow-1/2` override contradicts "No --ds-* redeclares" comment | **Fixed** — comment scoped ("surface/color"; shadow override is deliberate bloom preview). |

### Converged nits — accepted, no fix

- `Map`-dedupe hides a duplicated decl within a block (both parsers).
- `blockOf`-era regex anchoring quirks now moot after the declsOf port.
- Gallery pre-existing gaps (dark `--mat-sys-tertiary` unset under
  accent-'current'; inspector lists `--mat-sys-surface-variant`, defined
  nowhere) → belong to #1207/#1209/#1211's page work.
- Sibling-checkout-without-`npm install` fails rather than skips —
  arguably correct (the contract *is* pinned sass); guide documents it.
- `ui-color-sites.json` records pre-#1204 source strings — generated
  snapshot, refreshes on the FE sweep's re-run.

## Test results

```text
npx jest --coverage=false                259 suites / 4412 tests PASS
package verify.mjs (via npm run verify)  all checks pass (~1116)
design-system-theme-tokens-1204          44/44 PASS
design-system-tokens-1035 (package relay) all pass
design-system-consumption-1039           all pass (tokens emit through
                                         installed includePaths, vendor
                                         byte-identical)
design-system-foundation-migration-1171  110/110 PASS
jest src/app/features/ds-gallery         9/9 PASS (post-unmasking)
npm run sync:ds                          clean; vendor == canonical
```

## Verdict

**PASS** — two remediation rounds. R1 fixed 6 majors; the R2 re-attack
verified those held, surfaced one MEDIUM introduced by R1 itself (the
"BOTH modes" bridge overclaim) plus relay-parse asymmetries vs the
package verifier — all fixed. Axes then converged on nits only.
Deferrals are scoped to named later tasks (#1205 SA sync, #1209 dark
mat-sys bridge — ships with the #1207 bootstrap, #1211 palette lock,
#1163 missing roles, sweep for `--ds-surface-variant` retirement).
