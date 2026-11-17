# strat-manage-open-callable-1545

Verification for task **#1545 — "BE: Manual open pass callable (absorbs #157)"** (Topic #137, Thread #1510, Blueprint #1536).

Offline verification — exercises the real callable core with injected fakes; no credentials, no emulator, no network.

## What it checks

- **Auth guard** — `unauthenticated` before any dependency runs
- **Arg validation** — missing/blank/non-string `instanceId` → `invalid-argument`
- **Instance gates** — missing doc → `not-found`; `runState ≠ ACTIVE` → no-op `skipped: not_active` (the RH session is never opened); `mode ≠ paper` → no-op `skipped: non_paper` (v1 boundary)
- **Invocation** — ACTIVE paper instance delegates to `runManageOpenPass` with a session-bound `callTool` + ticket writer; the pass result (`positionId`, `legsResolved`, skip reasons) passes through unchanged
- **Idempotency** — a re-invocation hits the pass's own dedup (`already_opened_today`), not a duplicate open
- **Lifecycle** — the MCP session closes on success AND on a pass throw; session-open and pass failures map to `internal`

## Usage

```bash
npx tsx scripts/verify/strat-manage-open-callable-1545.ts
```

Expected output: every line prints `OK`, then `All checks passed.` — exit 0. Any `FAIL` line prints the expected value and exits 1.
