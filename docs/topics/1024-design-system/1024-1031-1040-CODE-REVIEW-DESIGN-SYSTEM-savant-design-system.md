**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** design-system-foundation  
**Issue:** #1031  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1040  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

# Code Review — #1040 `_pd-visual-language` delegation shim

**Verdict: PASS** (after in-flight remediation — see below)

## Scope

- `src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss`
  rewritten as a delegation shim: `@forward 'index'` (resolves via
  angular.json includePaths → `node_modules/savant-ds/styles`), `$up`/
  `$down` now `var(--ds-up)`/`var(--ds-down)` reads (identical literals),
  5 ungraduated data-display mixins kept sole-source with `#1052`
  graduation markers, header re-roled to "delegation shim"
- `scripts/verify/design-system-vl-shim-1040.{ts,md}` — relay + guide
- `run-all.ts` + `scripts/verify/README.md` — registration + index row
- `scripts/verify/ds-parity-probe.ts` — delegation-aware (below)

## Spec

All three ACs verified:

- **AC1** — `@forward 'index'` present; zero `@mixin` bodies for the 7
  delegated names. The 5 retained bodies are sole-source, not
  duplicates — the spec axis confirmed savant-ds defines none of them.
  Strict-reading ambiguity ("no bodies at all") resolved by the #1052
  follow-up's explicit scope: they're the un-graduated queue, marked
  inline.
- **AC2** — `npx jest src/app/features/portfolio-dashboard` — 33/33
  suites, 545/545 green. (Jest doesn't compile SCSS; stylesheet proof
  is the relay + `ng build`.)
- **AC3** — header names savant-ds as source of truth + maps each
  delegated name to its package partial + warns against re-adding bodies.

## Findings — remediated

- **R1 (spec axis, real regression) — the #1036/#1037 relays broke
  post-shim.** Their parity probe scans `_pd-visual-language.scss` for
  `@mixin` bodies → 7 `FAIL source missing mixin`; and the src fixture
  compile couldn't resolve the shim's `@forward 'index'` (savant-ds
  styles not in its loadPaths). Fixed in `ds-parity-probe.ts`: (a)
  delegated names satisfy the surface check via an `@forward`-detection
  branch (`OK source delegates X`); (b) src fixture loadPaths gains the
  ds styles dir; (c) the src side is now normalized too — post-shim the
  delegated mixin emits the same `var(--ds-*)` the package does.
  Net effect: the probes now diff *delegated emission vs package
  emission* through the real shim — a stronger check than the old
  body-vs-body comparison. Both relays re-run green.
- **R2 (all three axes converged) — relay fixture under-covered.** The
  "all 12 call-site names" check exercised 10 mixins + 2 vars — missing
  `vl.page-host` and `vl.content-column`, both real call sites. Added
  `.m`/`.n` to the fixture + selector checks.
- **R3 (adversarial) — no shadow guard on the shim's own directory.**
  `@forward 'index'` resolves importer-relative before loadPaths: a
  future `styles/_index.scss` would reroute invisibly. Added a
  `readdirSync` guard for `index*`/`_index.*`/`index/` entries plus an
  exactly-one-`@forward` assertion (a second `@forward './x'` could
  bypass delegation). Negative-tested: planted `_index.scss` → 16 FAILs.
- **R4 (adversarial LOW) — unbounded forwarded namespace.** If savant-ds
  ever forwarded tokens (against its own contract), every component
  `@use`ing the shim re-emits `:root`. Added a no-`:root` assertion on
  the fixture CSS.
- **R5 (standards) — `req('sass')` crash path** broke FAIL-not-crash
  discipline when the sibling checkout exists but `npm install` wasn't
  run. Wrapped; emits a FAIL check.
- **Nits:** `[\w-]+` mixin regex (package symmetry), guide check-count
  corrected to 39, fixture comment wording.

## Accepted / documented (not fixed)

- Relay compiles via `../savant-ds` + the package's pinned sass — a
  stale-copied `node_modules` junction could theoretically diverge;
  the #1039 relay owns junction-vs-sibling proof, and this relay is
  registered `needsPath: '../savant-ds'` alongside it.
- `SKIPPED`→exit 0 when the sibling is absent — the documented
  convention (all DS relays behave this way).
- When #1052 graduates the 5 retained mixins, Sass gives local members
  precedence over forwarded ones — a forgotten local body would
  silently shadow. The relay's "no unexpected extra mixins" check covers
  names not on either list; a re-added delegated-name body is caught by
  the delegated-no-local-body checks. Documented as the #1052 handoff.
- CHANGELOG entry lands in the ship commit per convention.

## Round 2 — remediation-diff self-audit (2026-10-17)

Narrowed pass over the round-1 fixes only (no new axes — per "don't go
crazy"). Negative-tested the new guards:

- **Extra `@forward 'page'` beside `'index'`** → `index is the only
  forward` FAILs (`index,page`) — a delegation bypass is now loud.
- **Dropped `header-bar` in savant-ds `_page.scss`** → shim relay FAILs
  15 checks (`Undefined mixin` cascade); #1036 relay + package verify
  fail through three independent layers (probe manifest, ds compile,
  fixture coverage). Delegation is proven live both directions.
- **Planted `styles/_index.scss`** (round 1) → shadow guard + all 14
  resolution checks FAIL.

Self-review of the probe edit: `srcDelegates` accepts `@forward` of
`index|page|dialog|feedback` — an unrelated-module forward falls through
to the old FAIL path. A name missing from *both* source and a specific
partial still fails via `dsFile missing mixin` or the `no source
selector` decl diff — no masking hole.

No new findings. Converged.

## Verification evidence

- `design-system-vl-shim-1040.ts`: **39 checks / 0 failures**
- Negative test: planted `styles/_index.scss` → shadow guard + all 14
  resolution checks FAIL (the compile correctly reroutes)
- `design-system-page-mixins-1036.ts` / `-dialog-mixins-1037.ts`:
  `=== ALL CHECKS PASSED ===` post-probe-fix — delegated emission diffs
  verbatim against the package
- `npm run build`: green (19.5s); the 9 `vl.*` call-site files compile
- `npx jest src/app/features/portfolio-dashboard`: 545/545
