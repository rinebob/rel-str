**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** design-system-foundation  
**Issue:** #1066  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1040  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

# UAT — #1040 `_pd-visual-language` delegation shim

**Result: PASS** — all ACs verified; S5 visual smoke noted as the manual
eyeball (mechanism-level proof below).

## Scenarios

### S1 — Relay green

`npx tsx scripts/verify/design-system-vl-shim-1040.ts` →
`=== ALL CHECKS PASSED ===` — 39 checks / 0 failures: `@forward 'index'`
(sole forward), zero duplicated delegated bodies, 5 sole-source locals,
`$up`/`$down` token reads, no `index*` shadow, header re-roled, all 14
`vl.*` members resolve + emit through the shim with no `:root` leakage.

### S2 — Build green

`npm run build` → clean (~19.5s). All 9 `vl.*` call-site files compile
through the shim — `@forward` resolution is load-bearing proof (any
miss = `Undefined mixin` per file).

### S3 — Jest

`npx jest src/app/features/portfolio-dashboard --coverage=false` →
**33/33 suites, 545/545 tests.**

### S4 — Regression

All DS relays green post-shim + post-probe-fix:
`1034` `1035` `1036` `1037` `1038` `1039` — `=== ALL CHECKS PASSED ===`.
The #1036/#1037 parity probes now diff delegated-vs-package emission
through the real shim (stronger than the old body-vs-body comparison).

### S5 — Visual smoke (mechanism + manual)

The delegated mixins emit byte-identical declarations to the retired
bodies — that's the `#1036/#1037` parity probes' whole job, re-verified
green post-shim. `vl.$up`/`vl.$down` read `--ds-up`/`--ds-down`, which
carry the identical `#4caf50`/`#f44336` literals. Manual eyeball
(optional but cheap): restart `npm run start`, open
portfolio-dashboard + any dialog (stop-loss / close-position consume
`dialog-chrome`/`dialog-status`) — should render pixel-identical.

## Findings

- **F1 — stale-serve collision (environmental).** Two 21:52Z rebuild
  failures (`Undefined mixin vl.header-bar`) were the negative-test
  windows — a planted `_index.scss` shadow and an extra `@forward` line,
  each live for seconds. Rebuilds before/after were green; no user
  action needed beyond the already-done restart.
- **F2 — #1036/#1037 relay regression (remediated in review).** The
  parity probe predated the shim — updated for delegation semantics
  (see CODE-REVIEW R1).

## Refinement

N/A — delegation preserves emitted CSS verbatim; no visual change
expected or made.
