**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #802  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #808  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# Code Review — BE: MCP session cache + concurrency/minInstances

## Axes

### Standards

- **major → fixed** — `robinhood-tool-executor.ts` reached ~513 lines
  (smell threshold 400). Extracted `tools/session-acquisition.ts`
  owning `ObservationSessionCache`, `McpCallTimeoutError`, `withTimeout`,
  `isSessionFailure`, `categorizeExecutionError`, `toolCallFailure`,
  `boundSessionConnect`, `closeSessionBounded`, `acquireMcpSession` —
  executor now 395 lines, and the session cache imports acquisition
  primitives instead of importing the executor (dependency direction fixed).
  Executor re-exports the moved symbols so existing importers
  (`run-probe-manifest`, `rh-api`, verify scripts) don't churn.
- **major → fixed** — `isSessionFailure` treated every non-timeout `Error`
  as a dead session, including `McpError` (a healthy JSON-RPC error
  response — unknown/unregistered tool, bad params). That would tear down
  a live session and sever in-flight sibling calls. Predicate now excludes
  `McpError` (instanceof + `name === 'McpError'` for duplicated-SDK
  robustness); regression test proves a throwing tool leaves the session
  cached (`transportCount === 0`).
- **minor → fixed** — `sessionFailure` was computed for ANY thrown error,
  including `parseToolResult`/`redactResponse` throws — a healthy-session
  proof being treated as session-dead. `runCall` now wraps only the
  `callTool` await in the classifying try; parse/redact errors return a
  plain failure envelope.
- **minor → fixed** — `ExecuteObservationToolOptions.session` doc claimed
  it applied to batch; batch acquires its own (or the cache's) connection.
  Comment corrected.
- **minor → fixed** — duplicate acquire/recover/timeout framing in the
  single-call and batch paths → one `boundSessionConnect(operation, ctx,
  budget)` helper.
- **minor → fixed** — `sessionFailure` doc drift vs. actual predicate;
  contract comment now states the exact semantics (callTool-thrown only,
  stripped at route boundary).
- **nit → noted** — `acquire()` reads the credential bundle per request
  (Firestore read). Correct-by-design — it's the token-rotation
  invalidation mechanism; cost is one read/request on a warm path that
  saves a full connect.

### Spec

| AC | Status |
|---|---|
| two sequential requests reuse one connection (tests + logs) | Met — `transportCount === 1` asserted; `rh_mcp_session` connect events wired to `logger.info` with reason (`cold`/`token_mismatch`/`recover`/`timeout_streak`). |
| auth/session failure triggers exactly one reconnect + retry | Met — `sessionFailure` flag → `recover()` → one retry; bounded test asserts `connectCount === 2` when the second session is still dead. |
| token change invalidates cached session | Met — reuse keyed on `entry.accessToken === repository.load().tokens.access_token`; rotation test asserts rebuild + subsequent reuse. |
| concurrency verified (multiplex or queue) + documented | Met — `maxInFlight === 2` proves the MCP SDK multiplexes concurrent `callTool`s over one transport via JSON-RPC ids (InMemoryTransport — direct StreamableHTTP proof not possible in-process; reasonable proxy). No queue needed. `concurrency: 8`, `minInstances: 1` set on `rhApi`. |

### Thermo-nuclear

- **critical → fixed** — hung `connect()` wedged the cache forever:
  `pending` was only cleared in `.finally`, and `connectLocalRobinhoodMcpSession`
  has no internal timeout (unbounded `fetch` + `client.connect`). A wedged
  connect would make every subsequent `acquire()` join the dead promise —
  all requests timing out until instance restart, on the one `minInstances`
  instance. The connect attempt is now bounded INSIDE the single-flight
  (`withTimeout(connect(), connectTimeoutMs ?? MCP_CONNECT_TIMEOUT_MS)`);
  the attempt keeps running after the bound fires and a late-resolving
  session adopts itself into `entry` (peer-check: if a concurrent attempt
  already adopted, ours is closed and the peer's returned) — the cache
  self-heals. Regression test: hung connect → first call fails at bound,
  second call succeeds on a fresh attempt (`connectCount === 2`).
- **major → fixed** — `sessionFailure` leaked onto the public wire
  contract (serialized verbatim to clients). Now stripped at the route
  boundary (`stripSessionFailure`) for single, batch-envelope, and
  per-item results; contract documents it as internal-only.
- **major → fixed** — file size + duplicated retry orchestration (same
  as Standards M1): session-acquisition module extracted.
- **minor → fixed** — `recover()`'s close of the failed session was
  unbounded while `connect()` bounded the same close at 5s; all close
  sites now use `closeSessionBounded`.
- **minor → fixed** — batch recover used a stale `remaining` captured
  before the failed call; budget recomputed as `deadline - Date.now()`.
- **minor → fixed** — `isSessionFailure` classified parse/redact throws
  (see Standards); classification now wraps only the `callTool` await.
- **minor → fixed** — `cacheAcquire`/`cacheRecover` merged into
  `boundSessionConnect`.
- **minor → noted** — connect-per-call mode never retries session failures
  (cache mode does). Deliberate: retry doubles connect cost on the path
  that exists because connects are expensive. Now commented.
- **minor → noted** — `instanceof McpError` breaks under duplicated SDK
  copies; hardened with a `name` check.
- **minor → fixed** — tests were order-dependent (`transportCount === 0`
  relying on a prior test's warm session); documented in-test. Added
  hung-connect and concurrent-recover-dedup tests.
- **nit → noted** — a late `noteOutcome('timeout')` can inflate the
  streak after a newer success on the same entry — inherent to
  fire-and-forget reporting, bounded by the identity check; acceptable.

## Remediation round (axes → remediated before this doc)

The Standards McpError finding and the Spec timeout-liveness finding were
remediated mid-review; the Thermo-nuclear axis then ran against the
updated code and surfaced the hung-connect critical, which was remediated
in the same pass.

- `tests/functions/rh-agent-mcp-session-cache.test.ts`: **11/11 pass**
  (added McpError-no-teardown, wedged-session rotation, hung-connect
  unwedge, concurrent-recover single-flight).
- Full `tests/functions/rh-agent-mcp*` cluster: **254/254 pass**.
- FE Robinhood MCP Jest suites: **72/72 pass** (shared contract touched).
- `functions` typecheck clean; eslint 0 errors (warnings pre-existing,
  none introduced).
- `git status` scoped — `robinhood-tools.ts`, `package.json` auto-paper
  hunks, `run-all.ts` and other WIP excluded; only #808 files reviewed.

## Round 2 — re-review of the remediated code

All three axes re-ran against the post-remediation diff
(`.devin/tmp/review-808-r2.diff`, 539 lines). Round-1 remediations verified
on every axis; the bounded-single-flight + late-adoption logic was attacked
specifically and held (single-flight `??=` ordering, synchronous
check-and-adopt, pending/finally lifecycle all race-free).

Findings — all minor/nit, none blocking:

- **minor → fixed** — three dead re-exports on the executor
  (`MCP_CONNECT_TIMEOUT_MS`, `McpCallTimeoutError`,
  `ObservationSessionCache`); only `categorizeExecutionError`/`withTimeout`
  retain live consumers (`run-probe-manifest`).
- **minor → fixed** — `McpCallTimeoutError` reused for a *connect* timeout
  in `rebuild` (semantic drift); the bound now goes through
  `boundSessionConnect(this.connect(reason), 'session rebuild (…)')` —
  consistent message format, no mislabeled error class.
- **minor → fixed** — batch recover budget could go ≤0 → instant reject
  with a negative-seconds message; an explicit budget-exhausted entry is
  pushed instead, matching the dispatch guard.
- **minor → fixed** — "No stored Robinhood credential…" literal
  tripled (connection ×2 + cache); now a shared
  `NO_STORED_CREDENTIAL_MESSAGE` const.
- **minor → fixed** — contract comment said "session cache retries" —
  the executor retries via `cache.recover()`; corrected.
- **noted, no action** — per-item recover amplification (a 20-item batch
  on persistently-dead sessions does ≤~21 connects): bounded, sequential,
  only in already-broken states. Token-mismatch close severing a sibling's
  in-flight mutation: deliberate tradeoff, documented. Test order
  dependence: documented in-file. `SessionCacheEvent.type` single-member
  literal: extensible seam, no action.

Post-round-2 gates: `functions` typecheck clean; full
`tests/functions/rh-agent-mcp*` cluster **254/254 pass**.

**Converged — review loop closed.**

## Design decisions kept

- **No in-instance queue** — SDK multiplexes; verified, documented.
- **Timeout never retries the call** — a timed-out call may still be
  executing server-side; retrying a mutation could double-submit. A
  3-consecutive-timeout streak rotates the session instead (liveness
  repair without re-invocation).
- **`recover()` adopts a peer-rotated session** rather than
  double-closing a connection a sibling may be using — identity check on
  `entry.connection === failed`.
- **Fire-and-forget streak rebuild** — `noteOutcome` kicks `rebuild` in
  the background so the reporting call isn't blocked.

## Verdict

**PASS** — all acceptance criteria implemented and tested; the one
critical (hung-connect wedge) and both majors remediated and re-verified;
remaining minors are documented design choices.

Next: `/proj qa 657 808`
