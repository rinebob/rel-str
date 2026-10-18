# CODE-REVIEW — #1042 SA smoke test (av-proxy-api consumes savant-ds)

Review of the #1042 diff across two repos (av-proxy-api consumption wiring +
rel-str cross-repo relay) against the issue's ACs and sibling conventions.

## Verdict — PASS (1 remediation applied)

Three-axis review on the uncommitted diffs in both checkouts.

## Spec axis — ACs

| AC | Result |
|---|---|
| SA `npm install` resolves `savant-ds` via `file:` | PASS — `file:vendor/savant-ds`, lockfile records `resolved: vendor/savant-ds`. **Deliberate spec divergence:** issue text says `file:../savant-ds`, but SA deploys via App Hosting — a sibling path fails cloud builds exactly as rel-str did pre-#1071. Vendored is the established fix and still satisfies the `file:` AC. |
| SA `ng build` green with the includePaths entry | PASS — 17.5s, only pre-existing warnings (bundle budget, CommonJS shared modules) |
| One SA element renders using savant-ds tokens/mixins | PASS — `bz-no-results` consumes `@use 'index' as ds` + `@include ds.state-block`; emitted bundle verified to carry the full mixin contract (host + `mat-icon` + `p` + `.hint`) |

## Standards axis

- Vendored consumption mirrors rel-str #1071 exactly: committed
  `vendor/savant-ds`, `file:vendor/savant-ds` dep, `sync:ds` refresh
  script (plain `.mjs`, no new deps).
- `@use 'tokens'` emitted once from `styles.scss` (package contract).
- `--mat-sys-*` bridge documented inline — SA's prebuilt `indigo-pink`
  theme emits none, so the DS surface/feedback aliases would resolve
  empty; the 6 vars the package reads map onto SA's own palette
  (`--text-secondary` → `on-surface-variant`, `--warn-color` → `error`,
  `--divider` → `outline-variant`, etc.).
- `state-block` is the semantically correct mixin for `bz-no-results`
  (empty-state block) — the row→column + accent→muted-icon change IS
  the standardization, not a regression.
- Relay mirrors sibling relay shape; `needsPath: '../av-proxy-api'`
  skips cleanly where the checkout is absent.

## Adversarial axis — one real hole found + fixed

| # | Finding | Fix |
|---|---------|-----|
| R1 | `index*` shadow — SA's `includePaths` puts `src/styles` **before** the package, and importer-relative resolution precedes both. A `_index.scss` in `src/styles/` or beside `bz-no-results` would silently reroute `@use 'index'` (the #1040 vulnerability class) | Shadow guards added: `src/`, `src/styles/`, each consumer dir |
| R2 | Same class, wider vector — round 1 guarded only `index`; but `styles.scss` imports `@use 'tokens'` too, and a `_tokens.scss` (or any partial-named file: `_page`, `_dialog`, …) in those same locations reroutes it identically | Guard generalized — derives the shadowable set from the package's `styles/` dir (all partial names), checks `src/`, `src/styles/`, and every consuming component dir. Negative-tested: planted `_tokens.scss` + `_index.scss` fail, removed → 13 checks green |

**Probed, clean:** junction resolution (`node_modules/savant-ds` →
vendor), lockfile `resolved` entry, `file:` spec under `npm ci` (vendor
is committed inside the repo), `.gitignore` doesn't exclude `vendor/`,
no `.spec.ts` exists for `bz-no-results` to break, `@use` precedes
`@import` in `styles.scss`.

**Nit (informational):** the dropped `p { word-break/max-width }` could
let a very long no-results message overflow narrow viewports — the
state-block column layout largely absorbs it; acceptable for the
standardization pass.

## Evidence

- Relay `design-system-sa-consumption-1042.ts`: **13 checks green**
- SA `npm run build` — green (17.5s); emitted bundle carries
  `state-block` output + `--ds-*` tokens + `--mat-sys-*` bridge
- `npm install` — junction resolves to `vendor/savant-ds`
