# design-system-sa-consumption-1042.ts — SA smoke test (#1042)

Cross-repo relay verifying `av-proxy-api` consumes `savant-ds` end-to-end.
The work itself lives in the SA repo — this relay reads the sibling
checkout and fails loudly if the wiring drifts.

## What it checks

| Check | Detail |
|---|---|
| `file:` dep | `package.json` declares `savant-ds` (vendored spec per #1071 — a sibling `file:../savant-ds` breaks App Hosting builds, same lesson as rel-str) |
| includePaths | `angular.json` `stylePreprocessorOptions.includePaths` carries `node_modules/savant-ds/styles` |
| Token emit | `src/styles.scss` `@use 'tokens'` — the package's `:root` `--ds-*` emit happens once globally |
| `--mat-sys-*` bridge | SA's prebuilt `indigo-pink` theme emits no `--mat-sys-*` — the DS surface/feedback tokens alias them, so the app must supply the handful the mixins read |
| Vendor sync | `vendor/savant-ds/styles` exists, filenames match `../savant-ds/styles`, contents identical (line-ending normalized — IDE CRLF re-saves are not drift; `npm run sync:ds` in SA refreshes) |
| Package-name shadow guards | SA's `includePaths` puts `src/styles` **before** the package, and importer-relative resolution precedes both — a stray partial named like a package file (`_index.scss`, `_tokens.scss`, `_page.scss`, …) in `src/`, `src/styles/`, or beside a consumer silently reroutes `@use 'index'`/`@use 'tokens'`. The shadowable set is derived from the package's `styles/` dir — new partial names enter the guard automatically (negative-tested). |
| Real consumption | ≥1 `src/**/*.scss` file uses `@use 'index' as ds` |
| Live compile | That consumer compiles through SA's real includePaths and emits `var(--ds-*/--mat-sys-*)` declarations |

## Run

```bash
npx tsx scripts/verify/design-system-sa-consumption-1042.ts
```

Requires `../av-proxy-api` and `../savant-ds` checkouts (relay skips
cleanly via `needsPath` in run-all).

## SA-side files this verifies

- `vendor/savant-ds/` — committed package copy (styles + package.json)
- `package.json` — `"savant-ds": "file:vendor/savant-ds"` + `sync:ds` script
- `angular.json` — `node_modules/savant-ds/styles` in includePaths
- `src/styles.scss` — `@use 'tokens'` + `--mat-sys-*` bridge block
- `src/app/feat/bz-calendar-view/comps/bz-no-results/bz-no-results.component.scss`
  — `@use 'index' as ds` + `@include ds.state-block` (empty-state convention)
