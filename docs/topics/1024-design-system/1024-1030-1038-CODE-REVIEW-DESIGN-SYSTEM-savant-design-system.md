**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** design-system-foundation  
**Issue:** #1030  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1038  
**Domain:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# Code Review — #1038 Index forwards + sass-compile verify

**Verdict: PASS** (after in-flight remediation — see below)

## Scope

Verification-layer task — no runtime/mixin code changed. The diff is the
*consolidation* layer that turns per-task checks into a closed public
surface:

- `savant-ds/scripts/verify.mjs` — new: `STYLES_MANIFEST` directory
  set-equality, `_index.scss` forwards-exactly-{page,dialog,feedback}
  manifest, `PAGE_FIXTURE`/`DIALOG_FIXTURE` hoisted to module constants,
  final public-surface coverage block (every `@mixin` defined in a
  forwarded partial must be exercised by an index fixture, both
  directions)
- `savant-ds/README.md` — status + verify prose updated to shipped
- `rel-str/scripts/verify/design-system-index-verify-1038.{ts,md}` —
  thin relay + guide (package stays authoritative; same shape as the
  #1035 tokens relay — no parity probe, nothing new to diff)
- `rel-str/scripts/verify/run-all.ts` — #1038 registration
  (`needsPath: '../savant-ds'`)
- `rel-str/scripts/verify/README.md` — #1038 index row

## Spec

All three ACs verified against real `sass` output:

- **AC1** — `@use 'index' as ds` exposes every #1036/#1037 mixin: forwards
  manifest set-equal `{page, dialog, feedback}` + both fixtures compile +
  coverage check proves every defined mixin is exercised
- **AC2** — `npm run verify` exits clean (340 checks) and provably fails
  on a missing token (manifest), missing mixin (surface equality +
  `Undefined mixin` compile), or missing/extra forward
- **AC3** — no `@import` in `styles/` (comment-stripped scan, unchanged)

Interpretive note: the issue body says "asserts each documented `--ds-*`
token appears in the output" — implemented on the `_tokens.scss` compile
(`:root` set-equality), not the index fixture, since `index` deliberately
doesn't forward `tokens` (emission contract). Satisfied per the reviewed
IMPL decision.

## Standards

No majors. Hoist refactor clean (constants referenced consistently, no
leftover inline copies); relay byte-identical in mechanics to the #1035
sibling; run-all/README rows match convention.

## Adversarial findings — remediated

The adversarial axis found real evasions in the *new* checks (the round
put `#1038`'s own additions under attack):

- **A1 — double-quoted `@forward "…"` was invisible.** The extraction
  regex required `'…'`; a `@forward "tokens"` passed the only-@forward
  gate while contributing nothing to the forwards set — `_tokens.scss`'s
  `:root` would emit into every component chunk, the exact emission
  contract the index header forbids. → Regex accepts both quote styles
  and the no-space form (dart-sass confirmed accepting `@forward'x'`),
  plus a count guard: every `@forward` statement must parse to a module
  name. Negative-tested: planted `@forward "tokens"` fails (5 checks).
- **A2 — manifest only saw top-level `.scss`.** A `.sass`/`.css` file or
  a `subdir/` is resolvable by dart-sass but escaped the directory diff.
  → `stylesEntries` diffs *all* `readdirSync` names (files + dirs)
  against the manifest. Negative-tested: planted `_evil.sass` and a
  `subdir/` each fail.
- **A3 — `//`-in-string truncates the comment stripper.** A line like
  `$x: 'https://x'; @mixin backdoor {}` loses everything after `//` to
  the line-strip — a real mixin could hide past the surface checks. →
  `lineCommentInString` heuristic flags an odd quote count before the
  first `//` on any line (both axes converged on this gap). Negative-
  tested: planted string+hidden-mixin line fails.
- **A4 — `_tokens.scss` could define members.** Excluded from the
  coverage scan and never passed through `checkMixinSurface` — a
  `@mixin`/`@function`/`%placeholder` there entered `tokens.<name>`
  public API unverified. → New check: `_tokens.scss` defines no
  members. Negative-tested: planted `@mixin ghost` fails.
- **A5 — `exercised` was scanned from raw fixture text.** A commented-out
  `@include ds.x` would count as exercised. → Fixture strings are
  comment-stripped before the `@include` scan.

## Minors remediated

- `FORWARDS_MANIFEST` hoisted to module scope — the coverage block
  derives the mixin-bearing partial list from it (self-enforces "every
  mixin module is forwarded"); also fixes a ReferenceError when
  `_index.scss` is missing (caught in self-review before commit)
- `stripScssComments` helper extracted — the strip-regex pair was
  inlined at five sites
- Header comment updated to include #1038 in the task list
- Check-name wording clarified (`forwarded module 'x' is a manifest
  module` — "forwards manifest module 'x'" was ambiguous)

## Accepted / documented (not fixed)

- `exercised` regex requires the `ds.` alias — a future differently-
  aliased fixture would fail loudly (false-FAIL shape, not a hole)
- Duplicate `@forward 'page'` passes set-equality — dart-sass's
  duplicate-member error at fixture compile catches it downstream
- `@mixin` inside a Sass string (`$s: '@mixin ghost'`) overcounts as
  defined — false-FAIL, not evasion; exotic

## Round 2 — re-review of the remediated surface

Focused pass over the round-1 diff (no new axes — the convergent holes
were already closed). Two findings:

- **Directory named `*.scss` crashed the scan.** `readdirSync` names
  include directories; `partials` filtered on `.endsWith('.scss')`, so a
  `foo.scss` *directory* reached `readFileSync` and threw EISDIR —
  crash instead of clean FAIL. → `withFileTypes` + `isFile()` for
  `partials`; the manifest still diffs all entry names (dirs included).
  Negative-tested: planted `fake.scss` dir fails the manifest check.
- **Stray `.devin-index-bak` artifact** left at the savant-ds repo root
  by the round-1 attack tests — removed.

Accepted residual: an *unquoted* `//` mid-line (e.g. `url(//x)`) can
still truncate the strip — the guard covers the quoted-string vector,
the realistic one; noted, not armored further.

## Verification evidence

- `npm run verify` (savant-ds): **340 checks, 0 failures**
- Relay `design-system-index-verify-1038.ts`: ALL CHECKS PASSED
- Negative tests (all FAIL as designed, files restored):
  `@forward "tokens"` double-quote smuggle; planted `_evil.sass`;
  planted `subdir/`; planted `@mixin ghost` in `_tokens.scss`; planted
  `//`-in-string line hiding a mixin in `_page.scss`; planted
  `@forward'tokens'` no-space form
- Earlier rounds (this task's own negative suite): unforwarded
  `_rogue.scss` with a mixin, dropped `@forward 'feedback'`; round-2:
  planted `fake.scss` directory fails cleanly (was an EISDIR crash)
- jest: not re-run — verification-layer diff only, no app runtime code
