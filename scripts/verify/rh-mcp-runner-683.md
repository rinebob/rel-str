# Verify — #683 RH-MCP probe manifest runner

| # | What | Script | Needs |
|---|------|--------|-------|
| #683 | manifest runner core (filters, pacing, backoff, mutation gate, settle poll, captures) | `functions/scripts/verify/rh-mcp-runner-683.ts` | none (offline, mocked caller/prompt) |

Run from `functions/`:

```powershell
npx tsx scripts/verify/rh-mcp-runner-683.ts
```

The verify run drives the runner over the **real** manifest
(`docs/topics/657-rh-mcp/probe-manifest.json`) with a mocked tool caller and
scripted prompt answers — no Robinhood calls are made and captures land in a
temp dir that is cleaned up afterwards.

## Live runner (manual, needs RH MCP)

```powershell
cd functions
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"

# Plan only — validates against the bundled catalog, never connects:
npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --dry-run

# Step-through a single probe (still prompts at the mutation gate):
npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --only ro-accounts-01

# Resume after an abort:
npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --from <probe-id>
```

Behavior contract:

- **Validation** — real runs validate the manifest against the **live**
  `tools/list` (the bundled catalog can drift); `--dry-run` uses the catalog.
- **read probes** — unattended, ~300 ms spacing (`--pace-ms` tunes); a
  `success:false` or 429 backs off (jittered 1 s → 30 s) then asks
  `r` retry / `s` skip / `a` abort.
- **group checkpoint** — after each manifest group a summary prints and
  (interactive) waits for Enter/`a`; `--auto` skips the wait.
- **mutation probes** — hard stop per call: `y` executes, `n` records a
  declined capture, `abort` stops the run and prints the recovery checklist
  (open orders to cancel, positions to inspect, `--from` resume hint). There
  is intentionally **no bypass flag**.
- **settle** — a mutation entry with `settle: { tool, pendingStates?,
  intervalMs?, timeoutMs? }` polls the orders-list tool until no order is in
  `new`/`queued`/`confirmed`; timeout prompts `c`/`a`.
- **captures** — `captures/{id}.json` per probe: manifest args (with
  `$ENV:` placeholders intact — resolved values never persist), the
  **redacted** response only, latency, success/category, and skip reasons
  (`declined`, `missing-env`, `aborted`).
- **non-interactive stdin** fails closed — mutation prompts answer `n`.

Exit codes: `0` complete, `1` validation/connection failure, `2` aborted.
