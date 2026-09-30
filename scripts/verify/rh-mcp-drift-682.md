# Verify — #681/#682 RH-MCP discovery harness

Two scripts cover the probe harness:

| # | What | Script | Needs |
|---|---|---|---|
| #681 | probe manifest loader/validator | `functions/scripts/verify/rh-mcp-manifest-681.ts` | none (offline) |
| #682 | catalog drift diff logic | `functions/scripts/verify/rh-mcp-drift-682.ts` | none (offline) |

Run from `functions/`:

```powershell
npx tsx scripts/verify/rh-mcp-manifest-681.ts
npx tsx scripts/verify/rh-mcp-drift-682.ts
```

## Live drift check (the real thing, #682)

The verify script above only exercises the diff logic offline. To produce the
actual drift capture you must call the live MCP server:

```powershell
cd functions
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx src/rh-agent-mcp/diagnostics/run-drift-check.ts
```

Prerequisite: a stored local Robinhood credential (same auth path as
`executeObservationTool`). Requires the IPv4 `NODE_OPTIONS` preload.

- Pass: prints `NO DRIFT` or a `*** DRIFT DETECTED ***` section, and writes
  `docs/topics/657-rh-mcp/captures/00-drift.json`.
- Fail: non-zero exit with the connection error (re-run local OAuth bootstrap
  if the credential is stale).

Note: the committed `00-drift.json` is the **discovery baseline** — the
2026-07-17 catalog vs live (76 vs 49). It intentionally documents that
delta; the catalog has since been regenerated (via `refresh-tool-catalog.ts`),
so a fresh run correctly reports `NO DRIFT` — re-run only when establishing
a new baseline.
