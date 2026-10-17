# Verify guide — #1037: savant-ds dialog/feedback mixins (`_dialog.scss` + `_feedback.scss`)

## What it proves

`scripts/verify/design-system-dialog-mixins-1037.ts` runs the package's
own `npm run verify` inside `../savant-ds` and relays its result. The real
checks live in `C:\aa\projects\savant-ds\scripts\verify.mjs`:

- `styles/_dialog.scss` exports exactly `dialog-chrome` + `dialog-status`;
  `styles/_feedback.scss` exports exactly `error-banner` (mixin-surface
  set-equality both directions)
- all three compile through a `@use 'index' as ds` fixture via `loadPaths`
- declaration-anchored verbatim semantics: dense form-field custom props
  (`--mat-form-field-container-*` bound to `--ds-space-1`/`--ds-field-height`),
  16px title row, flex-column content, `.dim`/`.dialog-error` blocks,
  compact 32px actions; `.status-section` + `.success`/`.error` accents,
  `.result-row`, `.error-message`; tokenized error banner
- accent colors reference `--ds-*` tokens (`--ds-up`, `--ds-error`) — no
  hex literals anywhere in emitted output
- `.spinner` emits `animation: spin …` but the package does NOT redefine
  `@keyframes spin` (resolves the app's global keyframes)
- emission contract: `@use 'index'` emits only fixture classes — no
  `:root`/dark/stray rules
- direct `@use 'dialog'` / `@use 'feedback'` resolution via `loadPaths`

## What the relay adds locally

After the package verify passes, this script runs the shared
**verbatim-semantics parity probe** (`scripts/verify/ds-parity-probe.ts`)
for the dialog partial and the feedback partial: it compiles each mixin
from BOTH savant-ds and the source
`src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss`,
normalizes `var(--ds-*)` to whatever the compiled `_tokens.scss` `:root`
block actually declares (derived map — token-value changes surface as
real diffs), and diffs emitted declarations per selector. `OK` means
byte-identical semantics; any `source-only`/`ds-only` line is a FAIL.

## Usage

```bash
npx tsx scripts/verify/design-system-dialog-mixins-1037.ts
```

## Passing

The relayed `npm run verify` prints `OK` per check and ends with
`All checks passed.`; the parity probe prints per-selector `OK` lines and
this script ends with `=== ALL CHECKS PASSED ===` + exit 0.

## Failing

Any `FAIL` line in the relayed output, `=== PACKAGE VERIFY FAILED ===`,
or `=== N PARITY DIFF(S) ===` — all exit 1.

## Setup / teardown

- Needs the sibling checkout at `C:\aa\projects\savant-ds`; without it
  run-all reports SKIPPED (`needsPath`), and this script exits 0 with a
  SKIPPED line when run standalone.
- No credentials, no network, nothing written.
