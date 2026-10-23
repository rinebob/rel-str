# Verification Guide — Theme token layer (#1204)

**Task:** #1204 — SHARED: theme token taxonomy + emission
**Thread:** #1161 Theme & Palette · Topic #1024 Savant Design System
**Pipeline stage:** savant-ds `_tokens.scss` → sass compile → emitted CSS → vendored copy

## Scripts

### `design-system-theme-tokens-1204.ts`

```bash
npx tsx scripts/verify/design-system-theme-tokens-1204.ts
```

Runs from the repo root. No credentials required. Requires the sibling
`../savant-ds` checkout AND `node_modules/savant-ds` (npm install);
prints `SKIPPED` and exits 0 without either. `sass` resolves through the
package's own package.json — the version its verify pins.

**What it checks:**

1. `_tokens.scss` compiles through the installed
   `node_modules/savant-ds/styles` includePaths (same path the app build
   uses).
2. The `:root` block emits exactly the 47-token contract — set-equality
   both directions with boundary-exact declaration matching (neutral
   surfaces, text, borders, accent family, direction colors, feedback
   family, spacing/typography/density/elevation).
3. Emission model: light set under `:root`, dark overrides under
   `[data-theme=dark]`; the dark block covers every color token +
   shadows and no geometry token.
4. No `color-mix(` in shipped declarations (dev-page-only tool).
5. Direction defaults preserved in both modes: `--ds-up: #4caf50`,
   `--ds-down: #f44336`.
6. `vendor/savant-ds/styles/_tokens.scss` in BOTH consumer apps
   (rel-str and `../av-proxy-api`) is content-identical to the package
   source (fix drift with `npm run sync:ds` in the drifted app). The SA
   check SKIPs only when the sibling checkout is absent — a checkout
   present but missing the vendored file FAILs.

**Pass:** every check prints `OK` (optional sibling checks may print
`SKIPPED`), footer `=== ALL N CHECKS PASSED ===`, exit 0. **Fail:**
`FAIL` lines name the missing/drifted item, exit 1.

**Setup/teardown:** none. The script reads files only — no writes, no
network, no Firebase.
