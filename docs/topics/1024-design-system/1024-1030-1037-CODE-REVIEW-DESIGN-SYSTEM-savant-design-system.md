**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** design-system-foundation  
**Issue:** #1030  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1037  
**Domain:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# Code Review — #1037 Dialog/feedback mixins `_dialog.scss` + `_feedback.scss`

**Verdict: PASS** (after in-flight remediation — see below)

## Scope

- `savant-ds/styles/_dialog.scss` — new: `dialog-chrome`, `dialog-status`
  graduated from `_pd-visual-language.scss`, tokenized to `--ds-*`
- `savant-ds/styles/_feedback.scss` — new: `error-banner` (replaces the
  hard-coded `#fef0f0` banner)
- `savant-ds/styles/_index.scss` — `@forward 'dialog'` + `'feedback'`
- `savant-ds/scripts/verify.mjs` — dialog/feedback check surface
- `rel-str/scripts/verify/ds-parity-probe.ts` — shared parity-probe lib
  extracted from the #1036 relay (dedupes the machinery per relay)
- `rel-str/scripts/verify/design-system-dialog-mixins-1037.{ts,md}` —
  relay + parity probe; `run-all.ts`/README registration
- `rel-str/scripts/verify/design-system-page-mixins-1036.ts` — refactored
  onto the shared probe (shipped file; behavior preserved)

## Standards

Clean core — no majors. Both axes (standards + spec) verified
declaration-level parity and correct tokenization judgment: `--ds-font-size-md`
is 14px, so source `13px` correctly stays literal; `6px`/`20px`/`48px`/`280px`
correctly stay literal (no covering tokens); `--mat-sys-tertiary`/
`on-surface-variant`/`error-container` stay direct (manifest candidates,
documented in file headers). `ds-parity-probe.ts` is a clean extraction;
the #1036 refactor is behavior-preserving; the relay follows convention
(existsSync guards, FAIL-not-crash).

## Spec

All six acceptance criteria verified against real `sass` output:

- **AC1** — all three mixins exist and compile via `@use 'index' as ds`;
  mixin-surface set-equality per file
- **AC2** — `@keyframes spin` exists nowhere in `styles/` and nowhere in
  emitted output; `animation: spin 1s linear infinite` emits verbatim
- **AC3** — accents bind `var(--ds-up)`/`var(--ds-error)`; no hex literals
  in emitted output
- **AC4** — verbatim semantics proven by the parity probe: all 21
  selectors, every declaration, zero diffs
- **AC5** — `@use 'index'` emits only fixture classes; no `:root` leak
- **AC6** — direct `@use 'dialog'`/`'feedback'` resolve via loadPaths

## Thermo-nuclear findings — remediated

The adversarial axis found real holes in the *verification layer* (the
mixin implementations themselves were verified drift-free):

- **M1 — tokens compile was never stray-checked.** A top-level
  `@keyframes spin` or `body {}` in `_tokens.scss` shipped global CSS
  invisibly. → New check: tokens may emit ONLY `:root` +
  `[data-theme="dark"]` blocks; at-rule blacklist on the compiled CSS.
  Negative-tested: a planted `@keyframes spin` fails.
- **M2 — loud `/* */` comments fake declarations.** dart-sass expanded
  output preserves them; `tokenDecls`/`declsOf` could be fooled by a
  commented "declaration," and a `}` inside a comment truncates a parsed
  rule. → `stripComments` applied to all compiled CSS in both verify.mjs
  and ds-parity-probe.ts before any scan.
- **M3 — `_index.scss` contents unpoliced.** A `@mixin rogue { @keyframes
  spin }` or a `@forward 'extra'` there evaded every check — the cleanest
  AC2 evasion. → New check: `_index.scss` must contain only `@forward`
  statements; partials must expose no `@function`/`%placeholder`.
  Negative-tested: a planted mixin fails.
- **M4 — `expectDecls` was subset-only; stray filter prefix-only.**
  `.probe-chrome-extra` / undocumented decls under asserted selectors
  evaded. → `expectDecls` is now bidirectional (extra emitted decls
  fail); stray filter anchors on the declared fixture roots with a
  follow-char whitelist.
- **M5 — dark block allowed extra overrides.** → Name set-equality:
  exactly `{--ds-shadow-1, --ds-shadow-2}`.
- **M6 — `needsPath` was cwd-relative.** Running run-all from the wrong
  directory silently skipped the DS relays. → Resolved against
  `REPO_ROOT` derived from `import.meta.url`.

## Minors remediated

- Parity-probe decl diff upgraded set-membership → **multiset**
  (duplicate declarations now compared by count, honoring verify.mjs's
  own "repeated selector can't silently overwrite drift" intent)
- Probe `existsSync` guards on both read files (FAIL-not-crash, matching
  the lib's own discipline)
- Direct-resolution checks anchored on real declarations
  (`animation: spin 1s linear infinite`, `display: flex`), not bare
  selector text — matching the #1036 check's strength
- `checkMixinSurface` deduplicated — the #1036 page section now reuses it
- `1037.ts` comment corrected — it claimed "one probe run covers all
  three" but the code correctly makes two calls (surface check is
  per-file)
- Partial header comments broadened to cover non-icon literals
- At-rule blacklist extended: `@container`/`@scope`/`@property`
- 1036 guide names the shared probe lib

## Accepted / documented (not fixed)

- `declsOf` can't parse declarations inside `@media`/`@supports` (no
  mixin uses them today — watch at #1038+)
- Missing-`savant-ds` → SKIPPED semantics kept (deliberate #1034 design
  for machines without the sibling checkout; cwd bug fixed)
- Named-color/`rgb()` literals outside `#`-hex in *extra* decls — the
  parity probe's extra-decl diff covers this layer
- `//`-comment stripping is string-literal-blind (contrived; noted)
- `loadPaths` shadowing risk noted for #1039 wiring (app partial named
  `index`/`tokens` in includePaths would shadow the package)

## Round 2 — re-review of the remediated surface

One focused pass over the round-1 fixes; three residual holes found and
fixed:

- **`viaUse.css` wasn't comment-stripped** — M2 residue. Fixed.
- **`blockOf` was first-match-only** — a *second* `:root` or
  `[data-theme]` block's declarations never reached the manifest or
  dark-set checks. Replaced with `declMapOf` built on `declsOf`, which
  concatenates same-selector blocks. Negative-tested: a planted second
  `:root { --ds-rogue: 999px }` now fails the manifest check.
- **`@use`/`@forward` inside a mixin partial was unpoliced** — M3's
  sibling hop (index-only check didn't cover partial-internal
  forwarding). `checkMixinSurface` now asserts partials have no
  `@use`/`@forward` hops. Negative-tested: a planted
  `@forward 'tokens'` in `_dialog.scss` fails the hop check AND Sass's
  forward-first ordering rule.

Also removed the now-dead `tokenDecls`/`blockOf` helpers; fixed a
self-inflicted syntax error (a literal `/* */` sequence inside the
verify.mjs doc comment terminated the block early).

Post-round-2 audit of the full surface: comment-stripping uniform across
all compile call-sites; `checkMixinSurface` covers mixin set-equality +
non-mixin members + hops; emission/stray checks anchored; dark block
set-equal. No remaining findings in scope.

## Round 3 — final pass

Full-diff audit of the round-1/2 changes: one nit (duplicated
concatenation comment referencing a deleted helper) — consolidated.
`probeRe` follow-char whitelist reviewed (over-strict on `#id`-suffix
selectors is intentional: emission contracts should fail closed). No new
findings — converged.

## Verification evidence

- `npm run verify` (savant-ds): **303 checks, 0 failures**
- Relay `design-system-dialog-mixins-1037.ts`: parity probe verbatim
  across all 21 selectors
- Relay `design-system-page-mixins-1036.ts`: green post-refactor
- Negative tests (all FAIL as designed): planted `@keyframes spin` in
  `_tokens.scss`; planted `@mixin rogue` in `_index.scss`; planted second
  `:root { --ds-rogue }` block; planted `@forward 'tokens'` in
  `_dialog.scss`
- jest: 3776 pass / 43 fail — identical to the known baseline (same 2
  unrelated suites; `screenshot-capture-contracts` reflects in-flight
  #964 enum expansion, `order.component` NG0201 is pre-existing)
