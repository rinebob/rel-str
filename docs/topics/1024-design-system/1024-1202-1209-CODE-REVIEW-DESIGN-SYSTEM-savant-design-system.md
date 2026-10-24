**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1202  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1209  
**Domain:** DESIGN-SYSTEM  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-23  
**Last Updated:** 2026-10-23  

# CODE-REVIEW — #1209 FE: --mat-sys dark+light bridge in styles.scss

## Verdict: PASS

All three axes converged with no critical or major findings. Review
findings were fixed in-review (see "Fixes applied"); remaining items
are nits or deliberate deferrals, listed below.

## Scope reviewed

- `src/styles.scss` — `--mat-sys-*` bridge restructured: 31-key dark
  set under `:root` (the app default), pre-change light set moved
  verbatim under `[data-theme="light"]`, `color-scheme` flips per mode.
- `scripts/verify/design-system-mat-sys-bridge-1209.ts` — new relay
  (real dart-sass compile through vendored includePaths, exact-literal
  pins, emission order, anti-smuggle count guard).
- `scripts/verify/design-system-mat-sys-bridge-1209.md` — guide doc.
- `scripts/verify/README.md`, `scripts/verify/run-all.ts` — index row
  + registration.
- `docs/topics/1024-design-system/1024-1161-1194-{IMPL,TEST}-*.md` —
  superseded-model notes added in-review.

## Standards — PASS (no hard violations)

- `sass.compile(file, {loadPaths})` usage verified against dart-sass
  1.97.3 (transitive via `@angular/build`); `createRequire` convention
  matches sibling relays (1171/1114/1115); `loadPaths` matches
  `angular.json` `stylePreprocessorOptions.includePaths` exactly.
- Relay structure, `check()` helper, banners, header docstring mirror
  the 1204/1207 relays; guide + README + run-all registration follow
  the documented convention.
- styles.scss: no standard violated; the duplicated 31-decl list
  across the two blocks is inherent to custom-property theming.
- Minor findings — all fixed in review (see below).

## Spec — PASS (all scriptable ACs met)

| AC | Verdict |
|---|---|
| `--mat-sys-*` under both `:root` (dark) and `[data-theme="light"]` | met — 31 keys each, pinned |
| light block = pre-change values | met — verified vs `git show HEAD:` verbatim |
| Sass compiles; specs green | met — relay compile through real loadPaths; jest 4471/4471 |
| `--ds-*` re-pointed to literals | met — `_tokens.scss` emits self-contained literals, zero `var(--mat-sys-*)` in token declarations |
| menus/dialogs/form fields legible in dark | pending-user-verification — manual AC, exercised at QA on :4210 |

- Scope creep: `color-scheme` flips not named in the task but directly
  serve the legibility AC — accepted as justified.
- Doc-sync finding: the IMPL/TEST docs still described the superseded
  `:root`-light + `[data-theme="dark"]` model. Both docs now carry a
  "Superseded by the #1209 task body" note. The task body's inverted
  model is correct: the attributeless fallback should match the
  bootstrap's dark default.
- Residual edge (noted, not a violation): attributeless render is
  split-brain (`--ds-*` light, `--mat-sys-*` dark); unreachable in-app
  because the #1207 bootstrap always writes the attribute. Documented
  in the guide.

## Thermo-nuclear — PASS (no critical/major)

- Whole-change path traced: index.html bootstrap → ThemeService sole
  post-bootstrap writer → styles.scss bridge → ~100 consumer files +
  vendored savant-ds mixins → ds-gallery host preview. No consumer
  reads `--mat-sys` keys outside the shipped 31-set.
- Literal-pinning judged the correct call — the bridge is a deliberate
  shim to a coexistence layer that #1163 removes; the DARK/LIGHT map
  duplication is the point of a pin (a drift detector needs an
  independent copy).
- `blocksFor` regex adequate: `[^}]*` correctly bounds flat emitted
  CSS; dart-sass's unquoted attribute-selector emission is real and
  fails loudly if it ever changes.
- Minors fixed in review (below); nits recorded.

## Fixes applied during review

| Finding | Fix |
|---|---|
| Relay `MATSYS_KEYS` duplicated `Object.keys(DARK)` (Standards minor) | removed; literal maps subsume per-key declaration checks |
| `existsSync(DS_STYLES)` sat after compile — dead-when-useful (Standards + Thermo minor) | moved before compile; missing dep now prints `SKIP` and exits 0, matching sibling-relay UX |
| Literal pins couldn't detect a smuggled later override (Thermo minor) | added "each key declared exactly twice" count guard (1204-relay parity) |
| `--app-header-height` check counted globally but claimed `:root` scope (Thermo nit) | now asserts presence inside a `:root` block AND global count 1 |
| IMPL/TEST docs describe superseded emission model (Spec finding) | added "Superseded by the #1209 task body" notes to both |
| Attributeless split-brain state undocumented (Thermo minor) | documented in the guide's model section |

## Recorded nits / deferrals

- `run-all.ts` entry has no `needsPath` for `node_modules/savant-ds` —
  the script itself SKIP-exits cleanly instead; acceptable either way.
- `require2('sass')` resolves a transitive dep — codebase-consistent
  with sibling relays.
- `ds-gallery.component.scss` keeps its host-scoped dark `--mat-sys`
  block — now a third copy of the ramp, but NOT wholesale-deletable
  (it covers light-app + dark-preview where the root attribute is
  light) and covers only 19/31 keys. Completion/dedup is #1211 scope,
  per plan. Its "until #1209 lands" comment is mildly stale.
- `--mat-sys-surface-container-low` ordering within the ramp is
  non-canonical in both blocks (pre-change light ordering preserved
  verbatim per AC).

## Test results

- `npx tsx scripts/verify/design-system-mat-sys-bridge-1209.ts` —
  **ALL 11 CHECKS PASSED** (check count dropped 41→11 after the
  per-key declaration checks were subsumed by the exact-literal maps;
  coverage increased — anti-smuggle guard added).
- `npx jest` full suite — **259/259 suites, 4471/4471 tests**.
- Dev server on :4210 rebuilt with the bridge; manual legibility
  spot-check deferred to `/proj qa` (it is the UAT's job).

## Verdict

**PASS** — no critical or major findings; minors fixed or recorded.
Task advances to `7_QA`.
