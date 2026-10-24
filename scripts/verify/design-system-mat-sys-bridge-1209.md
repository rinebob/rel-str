# design-system-mat-sys-bridge-1209

**Task:** #1209 — FE: `--mat-sys` dark+light bridge in `styles.scss`
**Thread:** #1161 Theme & Palette / Blueprint #1202 (FE)

## What it proves

The `--mat-sys-*` bridge in `src/styles.scss` emits both modes:

- dark set under `:root` — dark is the app default (#1207 bootstrap
  writes `data-theme` before paint), so the un-attributed fallback
  must be dark. All 31 `--mat-sys-*` keys pinned to exact literals
  (the ds-gallery demo dark ramp, neutral grey + indigo/pink/teal).
- light set under `[data-theme="light"]` — the exact pre-#1209 light
  literals, all 31 pinned verbatim.
- emission order — the light block follows `:root` (equal specificity,
  source order decides); `color-scheme` flips per mode so UA chrome
  (scrollbars, form controls) matches.
- no `[data-theme="dark"]` `--mat-sys` block — dark lives in `:root`.
- anti-smuggle — every key declared exactly twice in the emitted sheet
  (dark + light); a later re-declaration would silently win the cascade
  while literal pins stay green.
- `--app-header-height` stays mode-agnostic, once, under `:root`.
- `styles.scss` compiles through the vendored includePaths
  (`node_modules/savant-ds/styles`). Missing dep → SKIP exit 0.

## Why :root = dark (not the SHARED model)

The `--ds-*` token layer emits `:root` = light + `[data-theme=dark]` =
dark. This bridge deliberately inverts it per the #1209 task ACs
(`--mat-sys-*` under `:root` dark + `[data-theme="light"]` light): the
bootstrap default is dark, so the attributeless fallback should match
it. Both models render identically at runtime (the attribute is always
set); the bridge just fails safe toward the app's default.

Consequence of the inversion: if `data-theme` is ever absent, `--ds-*`
renders light while `--mat-sys-*` renders dark — a split-brain
attributeless state. The #1207 pre-paint bootstrap makes this
unreachable in the app (it writes the attribute before first paint);
it can only surface in pre-bootstrap contexts like jsdom harnesses that
never ran index.html.

## Run

```powershell
npx tsx scripts/verify/design-system-mat-sys-bridge-1209.ts
```

Pass: `=== ALL 11 CHECKS PASSED ===`, exit 0.
Skip: `SKIP — node_modules/savant-ds missing`, exit 0 (deps not installed).
Fail: `FAIL` lines naming the key/literal that drifted, exit 1.

## When it fails

- A `--mat-sys-*` key went missing or its literal changed → the diff
  tells you which side (light pinned = pre-#1209; dark pinned = the
  bridge ramp). Intentional palette changes update the map in the
  script.
- Compile failure → Sass error text is printed (loadPaths or syntax).
