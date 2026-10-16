**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** design-system-foundation  
**Issue:** #1030  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1035  
**Domain:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# Code Review — #1035 Token layer `_tokens.scss`

**Verdict: PASS** (after in-flight remediation — see below)

## Scope

- `savant-ds/styles/_tokens.scss` — new: `--ds-*` custom properties under `:root`, dark overrides under `[data-theme="dark"]`
- `savant-ds/styles/_index.scss` — entry-point contract clarified (mixins only)
- `savant-ds/scripts/verify.mjs` — real token-surface verification via the package's `sass` devDep
- `savant-ds/README.md` — consumption contract + honest scaffold markers
- `rel-str/scripts/verify/design-system-tokens-1035.{ts,md}` + `run-all.ts`/`README.md` registration

## Standards

Initial findings: material-alias tokens have no fallback values (invalid at
computed-value time if the app emits no `--mat-sys-*`); token checks were
one-directional; alias check asserted only one representative alias;
`@import` scan missed `/* */` comments; `_index.scss` header comment did
not record the emission contract.

**Remediation applied:**

- `_tokens.scss` header now states the hard prerequisite explicitly: the
  consuming app MUST emit a Material theme before the token layer or the
  mirrored aliases resolve to nothing — documented rather than hidden by
  silent fallbacks (fallback literals would mask a missing theme and are
  the wrong contract during a Material exit).
- `verify.mjs` strips both `//` and `/* */` comments before the `@import` scan.
- `_index.scss` comment rewritten: it is the mixin entry point and will
  never forward `tokens` (see Thermo-Nuclear major below).

Clean post-remediation: no `any`/`as` escape hatches, verifier is readable
diagnostics code, file sizes trivial.

## Spec

All three acceptance criteria verified against real `sass` compile output
(not text presence):

1. `_tokens.scss` emits all documented token names under `:root` — **met**;
   now enforced bidirectionally (emitted set == manifest set).
2. `[data-theme="dark"]` overrides present, following
   `_variables-global.scss` convention — **met**; dark block emits only
   shadow overrides, verified as a subset of the root token set.
3. Material-mirroring tokens alias `var(--mat-sys-*)` — **met**; each of
   the five mirrors is asserted against its documented target individually.

Doc fix: the IMPL doc's `_index.scss` forwarding spec contained the
emission trap — corrected to "forwards mixins only; tokens emit once via
`@use 'tokens'` in the global stylesheet."

## Thermo-Nuclear

Two majors found, both remediated:

1. **Emission-contract trap** — forwarding `tokens` from `_index.scss`
   would re-emit the `:root` block into every Angular component's
   encapsulated style chunk whenever a component wrote `@use 'index' as
   ds` (dead CSS per chunk). Resolved: `_index.scss` documented as
   mixins-only; the tokens path is `@use 'tokens'` once in `styles.scss`;
   README states the contract explicitly. Forwarding list deferred to
   #1038 when mixin modules exist.
2. **Token-list drift** — the manifest check was a one-directional subset:
   a token added to `_tokens.scss` but not the manifest would never be
   verified. Resolved: the verifier parses the compiled `:root` block and
   enforces set equality both directions; dark-block tokens are asserted
   ⊆ root tokens; each `--mat-sys-*` alias is bound to its documented
   target individually.

A real verifier bug was caught during remediation: the dark-selector
alternation `("dark"|dark)` captured group 1, so `match()[1]` returned the
quote literal instead of the block — fixed with a non-capturing group, and
the failure mode proved the check actually exercises the block.

## Tests

- `npm run verify` (savant-ds): all checks pass — compile, set-equality,
  dark subset, per-alias binding, `loadPaths` consumer resolution.
- `npx tsx scripts/verify/design-system-tokens-1035.ts` (rel-str): pass.
- Full jest: 3,754 pass / 43 fail — identical to the documented baseline
  (same two unrelated suites red at HEAD: `screenshot-capture-contracts`
  enum drift, `order.component` missing Functions provider). No #1035 app
  code implicated.

## Re-review (round 2)

Re-audit of the remediated surface found one minor:

- **Value drift was unverified** — set-equality covered token *names*, but
  a changed literal (e.g. `--ds-space-1: 999px`) would pass. Fixed:
  `LITERAL_VALUES`/`DARK_VALUES` maps assert exact compiled values for all
  20 literal tokens and both dark overrides. Negative-tested: a doctored
  `999px` value fails the check.

No further findings — verifier now pins names (set equality), values
(exact match), dark subset, and per-alias targets. 86 checks, all green.

## Disposition

All findings addressed. Task is ship-shaped pending QA.
