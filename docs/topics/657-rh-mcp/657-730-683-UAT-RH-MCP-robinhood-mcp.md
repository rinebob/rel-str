**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Issue:** #730  
**Task:** #683  
**Blueprint:** #680  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-01  
**Last Updated:** 2026-10-01  

# UAT — #683 Manifest runner + capture writer + mutation gate

## Scope

Task ACs: (1) capture files written **redacted only** (redactor runs before disk); (2) `--only <id>`, `--group`, `--dry-run`, resume-from-id (`--from`) work; (3) mutation gate has no bypass flag — per-call `y`/`n`/`abort`; (4) settle poll + abort checklist verified with mocked executor.

Out of scope here: a **live approved mutation** (`y` → real order). That is deliberately not exercised — the order-matrix session tasks (#685, #686) are the live-mutation carriers. The gate, decline path, retry re-gate, and settle poll are covered by scenarios 7–9 + the mocked-executor suite.

## Prerequisites

- Repo at branch `prod`; Node 24; `cd functions` for all commands.
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` (IPv6 workaround — set at user level; new terminals pick it up).
- Scenario 8 (live read) needs a stored local RH credential (OAuth bootstrap) — same auth as `executeObservationTool`. Everything else is offline.
- Scenario 9 uses a **dummy** env value — the probe is declined at the gate, so no real value is needed and no order is placed.

## Scenarios

### 1. Offline verify (mocked caller/prompt over the real manifest)

```powershell
cd functions
npx tsx scripts/verify/rh-mcp-runner-683.ts
```

Expected: 6 checks `OK`, `6 passed, 0 failed`, exit 0. Covers: end-to-end run with fakes, mutation abort → checklist + halt, helpers (rate-limit detect, env resolve, pending scan, checklist), CLI has no mutation-bypass flag, dry-run plan formatting.

**Result:** PASS — `6 passed, 0 failed`, exit 0 (2026-10-01).

### 2. Discovery unit suite (runner + manifest + drift)

```powershell
npm run test:rh-agent-mcp-discovery
```

Expected: `tests 118, pass 118, fail 0` — runner suite (118 total across the three files): sequential execution, pacing/backoff, retry/skip/abort prompts, mutation gating + re-gate on retry, settle poll (pending → settled/inconclusive/timeout), captures redacted + env-scrubbed, atomic write, resume hints, malformed-input handling. Also `npx tsc --noEmit -p tests/tsconfig.json` clean for the runner spec (enum/tool-field fix applied post-review — `tsx --test` does not typecheck).

**Result:** PASS — `118 passed, 0 failed`; runner spec tsc-clean.

### 3. `--dry-run` — full manifest plan

```powershell
npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --dry-run
```

Expected: prints `[read] ro-accounts-01 - get_accounts (account)`, `[read] ro-portfolio-01 - get_portfolio (account)`, `[mutation] mut-eq-market-buy-01 - place_equity_order (equity-orders)`, `3 probe(s) planned — dry run, nothing executed.`, exit 0. No calls, no captures.

**Result:** PASS — exact plan printed, exit 0.

### 4. `--group` filter + unknown group rejection

```powershell
npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --dry-run --group account   # → 2 probes
npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --dry-run --group bogus     # → error, exit 1
```

Expected: `account` → the two read probes; `bogus` → `--group "bogus" not found in manifest`, exit 1 (typo fails loudly, not a silent empty run).

**Result:** PASS — 2-probe plan for `account`; `bogus` errors with exit 1.

### 5. `--from` resume

```powershell
npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --dry-run --from ro-portfolio-01
```

Expected: plan contains `ro-portfolio-01` and `mut-eq-market-buy-01` only — `ro-accounts-01` skipped. (Mutation probes still re-gate on resume — no silent bypass.)

**Result:** PASS — 2-probe plan from the resume point.

### 6. `--only` unknown id rejection

```powershell
npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --only nope --dry-run
```

Expected: `--only id "nope" not found in manifest`, exit 1.

**Result:** PASS — exit 1 with the message.

### 7. Live read probe — real call, redacted capture (needs RH credential)

```powershell
npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --only ro-accounts-01 --auto
```

Expected: `-- group "account" complete: success=1`, `run complete: 1 ok`, capture at `docs/topics/657-rh-mcp/captures/ro-accounts-01.json`. The capture contains `outcome: "success"`, `latencyMs`, manifest-form `args` (`{}`), and the **redacted** response — account numbers masked `••••1655`/`••••5100`/`••••6245`, never raw.

**Result:** PASS — live call succeeded; capture inspected, all three account numbers masked, `agentic_allowed: false` visible. **AC1 verified against a real response.**

### 8. Missing env fails closed before any call

```powershell
npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --only ro-portfolio-01 --auto
```

(with `RH_ACCOUNT_NUMBER` unset)

Expected: `[skip] ro-portfolio-01: missing env RH_ACCOUNT_NUMBER`, `skipped=1`, exit 0 — the probe never calls the tool.

**Result:** PASS — skipped, no call attempted.

### 9. Mutation gate — decline path (dummy env is safe: the probe is never executed)

```powershell
$env:RH_ACCOUNT_NUMBER="dummy"; $env:RH_SYMBOL="dummy"
echo "n" | npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --only mut-eq-market-buy-01 --auto
```

Expected: gate banner `*** MUTATION probe mut-eq-market-buy-01: place_equity_order`, resolved args shown **masked** (`"account_number":"••••ummy"`), prompt `... 'y' run / 'n' skip / 'abort' stop — verify no live order exists first`, `'n'` → `[skip] ... declined by operator`, skip capture written, exit 0. No bypass flag exists on the CLI (scenario 1, check 4).

**Result:** PASS — gate fired, masked args, declined, no call.

### 10. Build

```powershell
npm run build
```

Expected: esbuild `Done`, `lib\index.js` emitted.

**Result:** PASS — `Done in 85ms`, 1.7mb bundle.

## Traceability

| AC | Scenarios |
|---|---|
| Captures written redacted only (redactor before disk) | 1, 2, 7 |
| `--only` / `--group` / `--dry-run` / `--from` work | 3, 4, 5, 6 |
| Mutation gate has no bypass flag; per-call y/n/abort | 1, 2, 9 |
| Settle poll + abort checklist verified with mocked executor | 1, 2 |

## Regression checklist

- [x] Manifest loader + drift suites still green (included in the 118) — scenario 2
- [x] rh-mcp tools/api/boundary suites green — 20/20, 8/8, 5/5 during review
- [x] Broker-order adapter + normalizer suites green (48/48 each) — `toolError` propagation safe — run during review
- [x] Build clean — scenario 10
- [x] Live credential path works end-to-end — scenario 7
