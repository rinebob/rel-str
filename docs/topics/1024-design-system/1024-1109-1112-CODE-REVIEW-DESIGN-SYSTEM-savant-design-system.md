# Code Review — #1112 widget verification relay + inventory update

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1109  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Task:** #1112  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Verdict: PASS

## Scope

- `scripts/verify/design-system-widgets-1112.ts` + guide — package/vendor,
  public Sass, gallery-contract, registration, and inventory relay.
- `scripts/verify/run-all.ts` + `scripts/verify/README.md` — relay
  registration and both-checkout prerequisites.
- `1024-1025-DS-INVENTORY.md` — nine widget rows graduated from Candidate
  to Extracted.
- FE IMPL/TEST plans — correct the phase-order contradiction: consumer
  migration checks are gates for Tasks #1114/#1115, not the Phase 1 relay.

## Standards

**PASS.** The relay follows neighboring design-system verification patterns:
repo-root derivation from `import.meta.url`, explicit check accounting,
nonzero exit on failure, a permanent guide, runner registration, and no
unsafe type erasure. Documentation headers preserve the required two-space
line breaks.

In-review fixes:

1. `run-all.ts` gained `needsPaths` so the relay skips unless both
   `../savant-ds` and `../av-proxy-api` exist.
2. Widget-kind counting now derives from the `MIXINS` contract rather than
   duplicating nine names and a magic count.
3. Vendor parity now requires actual byte equality, matching the acceptance
   wording.

Accepted nits:

- The self-registration check pins the literal `needsPaths` formatting; this
  matches the existing substring-check convention and makes drift visible.
- Direct standalone invocation treats missing sibling checkouts as failure,
  while `run-all` skips them; the guide documents both siblings as explicit
  prerequisites.

## Spec

**PASS.** Acceptance traceability:

| Requirement | Result |
|---|---|
| Package + ST/SA vendor parity | Met — `_widgets.scss` and `_index.scss` byte-identical in both consumers |
| Index forward + `vl.*` resolution | Met — exact forward check plus real nine-mixin Sass fixture through the shim |
| Exact nine-mixin surface | Met — set equality plus one check per mixin |
| Retired-scope guard | Met — executable Sass excludes verdict/ACR/expando/expansion/`--ds-verdict` |
| Nine gallery contracts | Met — entry, template case, and real `ds.*` include per widget |
| Relay guide + registration | Met — guide, README row, and run-all entry checked by the relay itself |
| Inventory graduation | Met — nine Extracted rows; none remains a Candidate row key |
| Consumer migration R6 | Correctly deferred to Tasks #1114/#1115; those files are not migrated in Phase 1 |

The IMPL shim path was corrected to the actual
`src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss`.

## Thermo-nuclear

**PASS.** The full contract path was traced:

`canonical package → ST/SA vendors → package index → vl shim → gallery
TS/HTML/SCSS → verification registration → inventory`.

In-review fixes:

- Candidate checks now inspect first-column row keys only; future candidate
  rows may cite an extracted widget as a migration target without false
  failure.
- `needsPaths` closes the runner's missing-SavantApi false-failure path.
- Dynamic widget regex removes a second source of truth.

No critical, major, or unresolved minor findings remain. The package verify
suite pins emitted semantics; the widget relay pins cross-repository and
consumer integration.

## Test results

- `design-system-widgets-1112.ts` — **85/85 PASS**
- `design-system-inventory-1043.ts` — **16/16 PASS**
- `design-system-ds-gallery-1041.ts` — **PASS**
- `design-system-sa-consumption-1042.ts` — **PASS**
- `savant-ds npm run verify` — **ALL CHECKS PASSED**
- Angular development build — **PASS**
- Full Jest suite — **241/241 suites, 4047/4047 tests PASS**

Two pre-existing stale expectations initially blocked the full gate and were
updated separately to match already-committed contracts: the expanded
`PositionType` enum and the shipped `DS Gallery (Dev)` menu entry.
