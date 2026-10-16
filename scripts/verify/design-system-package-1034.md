# Verify guide — design-system package skeleton (#1034)

| Script | Stage | Purpose |
|---|---|---|
| `design-system-package-1034.ts` | package | `savant-ds` skeleton exists at `C:\aa\projects\savant-ds` (git repo, package.json, styles/ + scripts/), `file:../savant-ds` resolves via `npm install --dry-run` from the repo root, and a real install into a scratch consumer lands `node_modules/savant-ds` as a link/junction |

### Usage

```bash
npx tsx scripts/verify/design-system-package-1034.ts
```

No credentials, no ADC, no network — the `file:` dep hits no registry and
`--no-audit/--no-fund` keep npm offline. The scratch consumer lives under
`.devin/tmp/ds-consumer-1034/` and is removed on completion.

### Pass / fail

- **Pass:** every check prints `OK`, script exits 0.
- **Fail:** offending checks print `FAIL` with detail, exits 1. Common
  causes: savant-ds repo not initialized, missing `styles/_index.scss`,
  npm falling back to copy-instead-of-link (junction expectation).
