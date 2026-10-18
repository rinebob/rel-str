# UAT — #1042 SA smoke test (av-proxy-api consumes savant-ds)

QA checklist for #1042, per CODE-REVIEW `1024-1031-1042-…`. QA issue: #1093.

## Verdict — COMPLETE

## Scenario log

| # | Scenario | Evidence | Result |
|---|----------|----------|--------|
| S1 | `npm install` resolves `savant-ds` via `file:` | `file:vendor/savant-ds`; junction in `node_modules`; lockfile `resolved: vendor/savant-ds` | PASS |
| S2 | `ng build` green with includePaths entry | SA build 13.5s; only pre-existing warnings (bundle budget, CommonJS shared modules) | PASS |
| S3 | One element renders via savant-ds | `bz-no-results` — `@use 'index' as ds` + `@include ds.state-block`; emitted bundle carries host/`mat-icon`/`p`/`.hint` selectors | PASS |
| S4 | Token layer emits + `--mat-sys-*` resolve | `styles.scss` `@use 'tokens'`; bridge maps the 6 vars the DS reads onto SA palette (prebuilt indigo-pink emits none) | PASS |
| S5 | Vendor⇄package sync | relay drift check (EOL-normalized): filenames + contents identical to `../savant-ds`; `npm run sync:ds` refreshes | PASS |
| S6 | Package-name shadow guards | planted `_index.scss`/`_tokens.scss` in `src/`, `src/styles/`, consumer dir → FAIL; removed → green | PASS |
| S7 | Cross-repo regression | all 10 DS relays green (9 sibling + #1042, 13 checks) | PASS |

## Evidence

- Relay `design-system-sa-consumption-1042.ts`: **13 checks / 0 failures**
- SA `npm run build` — green (13.5s, `npx ng build` with IPv4 preload;
  the first bare-`npm run build` attempt hit the known IPv6
  font-inline hang — environment quirk, not a code defect)
- Emitted bundle verified: `state-block` contract + `--ds-*` tokens +
  `--mat-sys-*` bridge all present
- SA `tsc`/component compile — `ng build` AOT covers it, green

## Not in scope

- SA-side jest/karma suite — SA runs karma (browser); the build +
  emitted-CSS verification covers the wiring ACs. No `bz-no-results`
  spec exists to break.
- SA commits — the issue notes SA commits are coordinated separately.
