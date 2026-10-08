**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #802  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #809  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# Code Review — BE: `POST /api/rh/batch` batch endpoint

## Axes

### Standards

- **major → fixed** — connect-lifecycle duplication: the batch handler
  copy-pasted the executor's connect+timeout+late-close block (the third
  copy of the options→connect mapping, after the executor and the
  rate-limit probe script). Extracted `acquireMcpSession()` inside
  `robinhood-tool-executor.ts` — both paths now share one acquisition
  helper, and the route file no longer imports session lifecycle internals
  (`connectLocalRobinhoodMcpSession`, `withTimeout`,
  `MCP_CONNECT_TIMEOUT_MS`, `ConnectedRobinhoodMcpSession` all dropped).
- **minor → fixed** — `const results = []` untyped; the executor's batch
  API returns an explicitly typed `ObservationBatchItemResult[]`.
- **minor → fixed** — `{ ...executorOptions, session }` spread propagated a
  caller-supplied `definition` into every batch item; the executor's
  per-tool mismatch guard caught it, but the design was fragile. The batch
  API now strips `definition` (documented per-tool) before dispatching.
- **minor → noted** — per-item `extraRedactFields` not supported. The batch
  wire is `{tool, args}` per the FE plan; redaction defaults suffice since
  the allowlist/audit paths never forward raw args. Deliberate divergence,
  documented on `ObservationBatchCall`.
- **nit → noted** — `rh-api-routes.ts` sits at ~305 lines (target <300,
  smell at >400). Splitting the route table mid-file for 5 lines buys
  indirection, not clarity; accepted.
- **nit → noted** — the #809 verify script repeats arg-parse/HTTP
  boilerplate from the #807 script; consistent with existing standalone
  verify-script conventions.

### Spec

| AC | Status |
|---|---|
| `POST /api/rh/batch` `{calls:[{tool,args}]}`, cap 20 | Met — `MAX_BATCH_CALLS`, +2 400 tests. |
| empty calls → 400 | Met + tested. |
| >20 calls → 400 | Met + tested. |
| per-item schema validation | Met + tested — non-object args → per-item `VALIDATION` while siblings succeed. |
| sequential, one MCP session | Met — `transportCount === 1` asserted per batch. |
| ordered results | Met + tested. |
| per-item success/error; one failure doesn't abort | Met + hardened — every dispatch is wrapped in try/catch, so a catalog-load throw becomes a per-item failure instead of a batch-level 500. |
| timeout per call honored | Met + tested — `callTimeoutMs` seam + a slow-tool test proves a timed-out item fails without poisoning the shared session. |
| auth before dispatch | Met + live-verified (401 unauth). |
| audit without args | Met + extended — connect-level failures now audit every requested call as `failure` (previously silent). |
| prod deploy + live smoke | Met — `rh-mcp-batch-809.ts` ran green against the deployed `rhApi` (401 unauth; 400s; mixed batch ordered/isolated). |

Response shape: the plan's "ordered `[{tool, result}]`" is met — every
entry carries `tool`, including failures (stamped in the batch API), so a
failure is self-describing without index correlation.

Design decisions kept: malformed items (missing/non-string `tool`) →
whole-batch 400, matching the single-call 400 contract; connect failure →
`{success:false, error, category}` envelope (matches single-call shape).

### Thermo-nuclear

- **major → fixed** — duplicated session-connect lifecycle (same finding
  as Standards M1): `acquireMcpSession()` is now the single owner of the
  connect+timeout+late-close dance.
- **major → fixed** — no batch-level deadline: 20 sequential calls at up
  to 45s each could run ~15 minutes vs `rhApi`'s 120s function timeout and
  the local API's 90s request timeout — a host kill loses every result.
  Added `MCP_BATCH_BUDGET_MS = 75_000` (headroom under both hosts,
  measured from batch start including connect); calls undispatched at the
  deadline get `MCP`-category failure entries instead of dispatching.
  Deadline test proves items 2+ never dispatch on a slow call 1.
- **minor → fixed** — connect failure wasn't audited (single-call path
  audits); now every requested call is audited `failure`.
- **minor → fixed** — `definition` leak via options spread (see above).
- **minor → fixed** — untyped `results` array (see above).
- **minor → noted** — `extraRedactFields` per item (see Standards).
- Stale-comment fix — `REQUEST_TIMEOUT_MS` comment in
  `robinhood-observation-api.ts` now references the 75s batch budget.

## Remediation round 1 (axes → remediated before this doc)

- `tests/functions/rh-agent-mcp-batch.test.ts`: **11/11 pass** (added
  arg-shape isolation, deadline, per-call-timeout/session-survival,
  connect-failure audit + category, `tool` on failure entries).
- `rh-agent-mcp-cloud-api` suite: **16/16 pass**.
- Full `tests/functions` run: **523/525** — the 2 failures are in
  `spread-proxy.test.ts`, which makes a real `oauth2.googleapis.com`
  token call (network-dependent, unrelated to this task).
- `functions` typecheck clean; `npm run lint` — 0 errors.
- Live verify against deployed `rhApi` (`rh-mcp-batch-809.ts`): PASS —
  unauth→401, empty/malformed→400, mixed batch→200 ordered/isolated.

## Remediation round 2 (re-review of the refactored code)

**Major → fixed** — the deadline gated *dispatch* only: a call started at
`deadline − ε` ran the full 45s, making worst case ~120s (>90s local). Now
`callTimeoutMs` per item is clamped to `min(callTimeoutMs, remaining)`, so
total execution ≤ `MCP_BATCH_BUDGET_MS` + close/audit — truly under both
host timeouts. Deadline test now pins the clamp (item 0 times out against
the remaining budget).

**Major → fixed** — local socket timeout destroys the response at 90s; a
trailing `sendJson` on it would throw `ERR_STREAM_DESTROYED` and crash the
dev server. `sendJson` now early-returns on `response.destroyed`.

**Major → routed to #808** — concurrent token-refresh stampede: up to 8
concurrent invocations can race `refreshAuthorization` on the same refresh
token; a loser whose refresh returns `invalid_grant` takes the generic
AUTH path with no reload-and-adopt, and (unverified) could brick the
credential family. **Pre-existing** — lives in the shared connect path,
predates batch (a batch is one connect vs 20 singles). Comment posted on
#808: session cache + single-flight refresh is its fix.

**Minor → fixed** — `close()` in both executor finallys is now bounded by
a 5s `withTimeout` (was an unbounded third-party await inside a
deadline-bounded function).

**Minor → fixed** — `readBody` leaked a pending promise on a
stalled/aborted body; added a `'close'` reject.

**Minor → fixed** — `call.tool` read hoisted into a safe `const tool`
before the deadline check, so even a malformed item reaching the executor
becomes a per-item failure rather than a loop abort (route still 400s
first — isolation is now self-contained in the executor).

**Nits → fixed** — redundant union in `ObservationBatchItemResult`
(`ToolExecutionResult` already includes failure); `options.session`
docstring now says batch ignores it; empty `calls` early-returns before
paying a connect; the three per-test http servers await `close()`.

**Noted, no action** — abandoned `callTool` residuals are bounded/benign
(SDK correlates by request id; `Promise.race` consumes late settles —
verified): SDK's own 60s timeout emits a late `cancelled` notification;
a late response could overwrite `transport._sessionId` out of order
(unverified whether RH reissues session ids); `close()` never sends
`terminateSession` (server-side TTL cleanup); `onAudit` throwing post-batch
500s the response (audit is `logger.info` — non-throwing); per-item
`extraRedactFields` remains a deliberate wire divergence.

## Test results (final)

- `tests/functions/rh-agent-mcp-batch.test.ts`: **11/11 pass**.
- `rh-agent-mcp-cloud-api` suite: **16/16 pass**.
- `functions` typecheck clean; `npm run lint` — 0 errors.
- Full `tests/functions` run earlier: 523/525 — the 2 `spread-proxy`
  failures are real-network `oauth2.googleapis.com` calls (unrelated).
- Live verify against deployed `rhApi` (`rh-mcp-batch-809.ts`): PASS —
  unauth→401, empty/malformed→400, mixed batch→200 ordered/isolated.

## Verdict

**PASS** — two rounds, converged: every in-scope finding remediated and
re-verified; the refresh-stampede major is pre-existing architecture routed
to #808.
