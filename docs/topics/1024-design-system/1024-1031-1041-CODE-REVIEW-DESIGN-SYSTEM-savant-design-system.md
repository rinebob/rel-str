# CODE-REVIEW — #1041 FE `/dev/ds` gallery (element showcase + provenance)

Review of the #1041 diff against the issue's ACs and the sibling dev-page
conventions (`dev-screenshot`, `dev/gallery`).

## Verdict — PASS (no remediations)

Three-axis review on the uncommitted diff: route/registry spec, mixin-source
pinning, dev-page conventions.

## Spec axis — ACs

| AC | Result |
|---|---|
| `/dev/ds` route under `authGuard`, loadComponent lazy-load | PASS — `core-routes.ts` block mirrors `dev/gallery`; relay + spec enforce |
| Every seeded element renders via `savant-ds` (not copied styles) | PASS — `@use 'index' as ds`; token cards read `var(--ds-*)` (emitted by the package's `tokens` partial in `styles.scss`); demo cards consume `ds.*` mixins; **zero local `@mixin` bodies** (relay-enforced; a fabricated mixin name fails the live sass compile) |
| `seen-in` provenance footnote per card | PASS — every `ENTRIES` element carries `seenIn[]`, rendered as a `seen in:` footer; relay pins the count |
| Dark-theme toggle flips `[data-theme="dark"]` and shows different values | PASS — host binding `dark() ? 'dark' : null`; `getComputedStyle` evidence displays resolved `--ds-shadow-1/2` (the only pure-DS values that differ today — no dark `--mat-sys-*` block exists; honest rather than faked) |

## Standards axis

- `standalone` + `OnPush` + signals + `styleUrl` — matches
  `dev-screenshot.component.ts`.
- `CUSTOM_ELEMENTS_SCHEMA` is intentional (documented in-code): the dialog
  demo renders `mat-dialog-content`/`mat-dialog-actions` DOM shape for the
  mixin to style without dragging in `MatDialogRef` DI — kills NG0304.
- `inject(ElementRef<HTMLElement>)` is a legal TS instantiation expression;
  used only for the `getComputedStyle` evidence read. `tsc --noEmit` clean.
- Relay mirrors the sibling relay template (header, `check()` shape,
  needsPath for the sibling checkout, `ALL CHECKS PASSED` marker).
- `.md` guide check-count matches the relay's actual check count (37).

## Adversarial axis — probed, no findings

- **`@use 'index'` shadow** — guarded: relay fails if any `index*` file
  appears under `ds-gallery/` (the #1040-review vulnerability class,
  pre-emptively closed here). Negative-tested.
- **Host-scoped `[data-theme]`** — deliberately scoped to the gallery
  subtree (preview, not app-theme hijack); `[data-theme="dark"]` sets the
  custom props on the host and they cascade to demo descendants.
- **Route-registry drift** — `core-routes.spec.ts` enforces
  `AppRoutes` ↔ `PAGE_INFO` ↔ leaf-route parity; `nav-sections.spec.ts`
  pins the dev child list including `dev/ds`.
- **Mixin overriding in demos** — `.mini-page`/`content-column` height and
  overflow overrides declared *after* the `@include`s, so they win the
  cascade deliberately (not accidental specificity luck).
- **Spec leak** — `requestAnimationFrame` callback does not leak open
  handles (`--detectOpenHandles` clean on the suite).
- **Nit (informational, not blocking):** density card labels `32px`/`40px`
  annotate `--ds-row-height`/`--ds-field-height` literally — a token bump
  would stale the label; acceptable for a dev page.

## Evidence

- Relay `design-system-ds-gallery-1041.ts`: **37 checks green** (route
  wiring, file presence, `ds.*` pinning, no local mixin bodies, no `index*`
  shadow, live sass compile through real includePaths, no `:root` leakage,
  template contract, dark-toggle spec).
- Jest: `ds-gallery` 4/4; `nav-sections` + `core-routes` — **129/129**.
- `npm run build` — green (15.1s); `@use 'index'` resolves through
  `vendor/savant-ds` includePaths.
- All 9 DS relays green end-to-end (#1034–#1052 + #1041).
