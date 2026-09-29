# Verify guide — #681 BE Probe manifest loader

One script covering the manifest pipeline end-to-end: real manifest file →
loader → catalog validation → gate safety checks → dry-run plan output.

## Scripts

| Script | Covers | Credentials |
|---|---|---|
| `rh-mcp-manifest-681.ts` | `probe-manifest.json` load + validate against real catalog; entry shape per probe; `$ENV:` placeholder annotation; plan formatting; negative gates (mutation-as-read rejected, unknown tool rejected) | none |

## Usage

```powershell
cd functions
npx tsx scripts/verify/rh-mcp-manifest-681.ts
```

No arguments, no flags. Reads `docs/topics/657-rh-mcp/probe-manifest.json`
relative to the repo — safe to run any time; makes no MCP connection and
requires no credentials.

**Pass:** all checks `OK`, plan printed, exit 0.
**Fail:** offending check prints `FAIL` with detail; exit 1.

## Notes

- Validating the real committed manifest means the script also catches
  manifest edits that break the format — it's both a code check and a
  data check.
- `$ENV:NAME` placeholders stay unresolved here; env injection happens in
  the runner (#683).
