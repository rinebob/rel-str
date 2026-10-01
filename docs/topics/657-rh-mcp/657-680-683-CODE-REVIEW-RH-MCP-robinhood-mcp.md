**Topic:** Robinhood MCP
**Topic Slug:** robinhood-mcp
**Blueprint:** #680
**Task:** #683
**Issue:** #683
**Domain:** RH-MCP
**Type:** CODE-REVIEW
**Reviewed:** 2026-09-30
**Last Updated:** 2026-10-01
**Result:** PASS (21 rounds — converged)

# Code Review — #683 Probe manifest runner

Axes: Standards (repo conventions) · Spec (task body + PRD/IMPL/TEST fit) · Thermo-nuclear (whole-change adversarial).

Scope: `probe-runner.ts` + `run-probe-manifest.ts` (new), `probe-manifest.ts` (+`settle` spec, `toToolDefinitions`, exported `ENV_PLACEHOLDER`), `robinhood-tool-executor.ts` (exported `withTimeout`/`parseToolResult`/`MCP_CALL_TIMEOUT_MS`/`categorizeExecutionError` — no behavior change), manifest settle entry, tests + offline verify + registrations.

## Round 1 — findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| H | `caller` dispatch: `isObservationTool` = `ALL_ENABLED_TOOLS` ⊇ all mutations → confirmed mutations routed to `executeObservationTool` (bundled-catalog validation → ajv `removeAdditional` silently strips live-only params like `direction` before a real order); `executeProbeMutation` dead code | Dispatch on `isMutationTool(tool) \|\| def?.mutation` → `executeProbeMutation` (live-schema validation); comment corrected |
| H | Mutation retry re-fired without re-gating → transport-timeout + `'r'` could double-place (no `ref_id` idempotency) | `'r'` on a mutation re-runs the y/n/abort gate with an explicit "order may already be live" warning; re-gate decline keeps `outcome:'error'` |
| M | `cap.error` persisted raw → resolved env values could hit a committed capture | `resolveEnvArgs` returns `secrets`; `scrubSecrets` masks them in captures, logs, prompts |
| M | Resolved args logged before consent (`tee` persists secrets) | Gate prints `maskResolvedArgs` — env-derived leaves masked via `maskAccountNumber` |
| M | Thrown caller → executed mutation left no capture/checklist | Per-entry try/catch: best-effort capture + checklist for mutations |
| M | Settle defaults missed `unconfirmed`/`partially_filled` | Defaults cover all non-terminal states |
| M | Settle record didn't persist observed pending orders | `SettleRecord.pending` + scrubbed `lastError` |
| M | Settle reused mutation args implicitly | `settle.args` manifest field merges over probe args |
| M | Non-interactive settle-timeout `'n'` continued (fail-open) | Only explicit `'c'` continues past a settle timeout |
| M | `--group` typo → silent empty plan, exit 0 | Unknown group + empty planned set → error |
| M | Checklist named nonexistent `get_positions`; post-execution `--from` self-reference could re-fire | Real tool names; resume id = next probe for post-execution aborts |
| L | Dup `ENV_PLACEHOLDER`/`MCP_CALL_TIMEOUT_MS`/`categorizeExecutionError`/`toDefinitions`; unused imports; import order; non-atomic capture write; no SAFE_PROBE_ID defense in runner; empty-string env; test fallback `'y'` masked unscripted prompts | All fixed; harness defaults to `'n'`; 10 regression tests added |

## Round 2 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| H | Last-probe abort: `nextId ??= entry.id` self-referenced → checklist `--from` would re-fire the executed mutation | `resumeId` is `undefined` on the last probe → checklist prints "nothing left to resume"; `formatAbortChecklist` param made explicit (no default) |
| M | Catch-path `error.message` unscrubbed (`secrets` scoped inside `try`) | Env resolution hoisted above `try`; catch scrubs |
| M | `settle.args` env placeholders unvalidated/unresolved → literal `$ENV:` poll args could false-settle | Loader collects settle placeholders into `requiredEnv` + typo-checks keys against the settle schema; runner aborts on missing settle env (checklist) instead of polling garbage |
| M | `writeCapture` pushed to the ledger before fs ops → double-push/outcome corruption on write failure; tail write outside `try` | Push moved after rename (+`includes` dedup); tail write inside `try` so write failures hit the checklist path |
| L | Success-after-retry kept stale `error`/`category`; 1-char secrets corrupted error text; catch clobbered a real success outcome | `delete` on success; `<4`-char secrets skipped; catch preserves outcome, appends thrown message |

Noted-not-fixed (accepted):
- `def?.mutation` is currently dead (flags derive from the same static set) — live `destructiveHint` reading deferred until a live-only mutation exists.
- Settle poll reads page 1 only — acceptable (orders newest-first, symbol-scoped); doc note.
- Cursor-following within probes and market-hours gating are #684+ scope per IMPL.

## Round 3 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | Catch-block resume hint passed `resumeId` unconditionally — a never-run probe (caller threw) would be skipped on `--from`, while the post-try policy correctly resumes at self | Catch mirrors the post-try policy: `cap.outcome === 'success' ? resumeId : entry.id` |
| M | `settlePoll` discarded settle-only resolved secrets — a settle error echoing a settle-only env value would persist unmasked to the capture | `scrubAll` composes probe-scrub + settle secrets for all settle error paths (`lastError`, timeout prompt, log detail) |
| L | Missing-env settle abort logged nothing — operator saw a bare checklist with no cause | `record.lastError` logged when `settleAborted` |
| L | Catch clobbered `skipped` → `error` when a write threw on a skip path | Catch preserves `'skipped'`; thrown message appends to `error` |

Verified clean: mutation dispatch order, re-gate retry (`'error'` bookkeeping correct — call fired), `captures.includes` dedup, `resumeId` scoping, all 4 `formatAbortChecklist` call sites, settle spec validation guards, fail-closed prompts.

## Round 4 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| L | Missing settle-env detected only post-fire — a confirmed mutation could fire before the settle poll found the missing env | `entry.settle?.args` resolved pre-gate; missing vars skip the probe (`missing-env`) before the mutation prompt. Post-fire settle check retained as defense-in-depth; both behaviors test-covered |
| L | `settlePoll` used `opts.log?.` while `log` defaulted locally in `runProbePlan` — settle progress silently dropped when callers omit `log` | `log` passed into `settlePoll` as a parameter |
| L | Catch-block `thrown` scrub covered probe secrets only — a settlePoll throw could persist settle-only env values | Scrub set merged (probe + settle secrets) at the hoist point; catch, failure log, and settlePoll all share it |
| L | `runProbePlan` didn't guard duplicate ids for non-loader callers — a second entry would overwrite `captures/{id}.json` | `seenIds` uniqueness check alongside `SAFE_PROBE_ID` |

## Round 5 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| L | Pre-flight settle-env check fired for read-gated probes whose settle spec the validator ignores | `settleEnv` resolution gated on `entry.gate === 'mutation'`; `allMissing` Set-deduped |
| L | settlePoll discarded its post-fire re-resolved secrets — asymmetric with the retained `missing` recheck | `settleArgs.secrets` folded into a local `scrubAll` composition |

## Round 6 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | `record.pending`/`detail` carried raw `id`/`state` from the unredacted `parsed` — an env-resolved order id persisted unmasked | Pending values scrubbed via `scrubAll` before persist/log |
| M | `scrubSecrets` substring-ordering leak — a shorter secret masked first fragmented a longer one ("5678" inside "12345678" left "1234" exposed) | Secrets sorted longest-first before replacing |
| L | Outer catch scrub lacked post-fire settle secrets (env mutating mid-run) | settlePoll wraps its loop in try/catch rethrowing `new Error(scrubAll(msg))` |
| L | `parsed === undefined` fallback could false-settle on redacted payloads with masked states | `inconclusive` flag: unverifiable responses keep polling → operator at timeout |

## Round 7 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | Tool-level `isError` payloads false-settled — transport-success error bodies carry no `state` fields → `pending=[]` → `settled=true` while an order may be live | `getToolLevelErrorMessage` (reused from broker-order-normalizer) detects `isError` in `parsed`; tool errors surface as `lastError` and never settle |
| M | `scrubAll`'s two-pass composition reintroduced the fragmentation leak across secret sets | Single sorted pass over the union (`secrets` + `settleArgs.secrets`); settlePoll signature takes `secrets: string[]` |
| L | `parsed === null`/primitive slipped past the `=== undefined` check | `parsedUsable = isPlainObjectSafe(parsed) \|\| Array.isArray(parsed)` gates both pending detection and inconclusive |
| L | `settle.args` skipped `validateToolArgs` at load — wrong-typed settle args only discovered after the mutation fired | `validateToolArgs(settleDef.inputSchema, sArgs)` added alongside unknown-key/placeholder checks |
| L | settlePoll executed `spec.tool` with no in-runner mutation check — a non-loader caller could fire an ungated mutation | `isMutationTool` guard returns an aborted record; CLI passes an injectable `definition.mutation \|\| isMutationTool` check for live-flag parity |

## Round 8 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | Envelope-level `isError` missed — non-JSON error text → `parsed` undefined → envelope `redacted` unchecked → false-settle (the dominant real-world error shape) | `toolError` falls back to `getToolLevelErrorMessage(res.redacted)`; `inconclusive` now covers ALL unusable-parsed responses (drop `hasStateFields` — a caller that never returns `parsed` can never confirm settlement) |
| M | `cap.response` persisted `result.redacted` verbatim — free-text error values (`error`, `text`) can echo resolved env values to disk | `cap.response` deep-scrubbed via `JSON.parse(scrub(JSON.stringify(redacted)))` |
| L | settlePoll mutation guard used the static set only — asymmetric with the loader's two-authority check | `opts.isMutationTool` injectable; CLI wires `definition.mutation \|\| isMutationTool` |

## Round 9 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | Envelope `isError` with a JSON-parseable body was invisible — the executor keeps the inner body as `parsed` and discards the envelope flag → false-settle | `toolError?: string` surfaced on `ToolExecutionSuccess` (contract) via new `toolEnvelopeError()` in the executor; both `executeObservationTool` and `executeProbeMutation` populate it; settlePoll checks `res.toolError` first in the error chain |
| L | `result.redacted === undefined` crashed the deep-scrub into a mislabeled success+abort | `scrubResponse` helper stringifies `redacted ?? null` before the round-trip |
| L | Probe-level tool errors recorded `outcome: 'success'` and vacuously settled | `result.toolError` now feeds the failure path — `cap.success=false`, `outcome='error'`, `category='MCP'`, retry loop; scrubbed payload kept in `cap.response` for the doc |
| L | Inconclusive settle records persisted with no reason | `lastError: 'unverifiable settle response — cannot confirm order states'` recorded |

## Round 10 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | `broker-order-adapter.ts` ignored `result.toolError` — envelope isError silently became an empty order/position page in authoritative reconciliation | `result.toolError ?? getToolLevelErrorMessage(result.parsed)` |
| L | `mcp-instrument-map-resolver.ts` same blind spot — isError body degraded to `{}` | `toolError` propagates as an Error before the `parsed` return |
| L | `toolEnvelopeError` 500-char truncation could split a secret mid-value, defeating downstream scrubbing | Truncation removed — full text is scrubbed downstream |
| L | Stale `cap.response` could pair an earlier attempt's payload with a later attempt's error | `cap.response` deleted on transport-failure attempts — always reflects the last attempt |

Known-limited (accepted): diagnostic one-off scripts (`cloud-credential-proof-function`, `run-tool-observation`, `option-quote-discovery-function`, `run-rate-limit-probe`) still read `parsed` without `toolError` — pre-existing diagnostics, outside #683.

## Round 11 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | Primary call trusted `entry.gate` unconditionally — a non-loader caller marking a mutation `gate:'read'` fired ungated (asymmetric with the settle-tool guard) | `mutationProbe = gate==='mutation' \|\| isMutation(tool)` (injectable two-authority check) drives the gate, retry re-gate, settle trigger, and checklist selection |
| L | `settle.pendingStates: []` from an injectable caller → empty set → instant false-settle | Empty array falls back to `DEFAULT_SETTLE_PENDING` |

## Round 12 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | Main loop checked only `result.toolError` (envelope channel) — a parsed-body `{isError:true}` payload recorded `success` and vacuously settled | Three-channel check mirrored in the call loop: `toolError ?? getToolLevelErrorMessage(parsed) ?? getToolLevelErrorMessage(redacted)` |

## Round 13 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | settlePoll's redacted channel was still gated `!parsedUsable` — an injectable caller with usable `parsed` + flagged envelope `redacted` false-settled (main loop had just been fixed) | Third channel unconditional, matching the main loop |
| L | `DEFAULT_SETTLE_PENDING` omitted `pending_cancelled` — a genuinely transitional option-order state | Added |
| L | `intervalMs`/`timeoutMs` accepted `Infinity` (data: seam) → infinite poll / hot loop | `Number.isFinite(v) && v > 0` |
| L | `scrubSecrets` skipped <4-char resolved values — module contract says resolved env values never reach disk | Floor removed; `maskAccountNumber` already emits `••••` for ≤4 |
| L | `unknownArgKeys` was top-level only — nested typo'd keys silently stripped by ajv | Recurses into object properties and arrays of objects |
| L | `mcp-instrument-map-resolver` checked `toolError` but not parsed-body isError — inconsistent with the adapter | `result.toolError ?? getToolLevelErrorMessage(result.parsed)` |

Test updated: `broker-position-adapter-integration` — "returns empty page when MCP tool throws internally" asserted the old silent-empty-page bug; now asserts `BrokerAdapterError`.

## Round 14 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | `settlePoll` trusted `spec.intervalMs`/`spec.timeoutMs` via `??` — an injectable caller passing `NaN`/`Infinity`/0/negative bypassed the loader check and got an unreachable deadline (never prompts) or a hot loop | `positive(v, fallback)` — non-finite or ≤0 falls back to `DEFAULT_SETTLE_INTERVAL_MS`/`DEFAULT_SETTLE_TIMEOUT_MS` |
| M | `spec.pendingStates` trusted via `?.length` — a non-array with `.length` (e.g. `"new"`) or a mixed array produced a set of non-states → every poll instantly "settled" post-mutation | `Array.isArray` + `every(string)` shape check → `DEFAULT_SETTLE_PENDING` |

Regression tests added for both (non-array `pendingStates` aborts at timeout instead of false-settling; `NaN` timing normalizes to defaults — sleep observed is the 2000ms default). Pre-existing tests using `intervalMs/timeoutMs: 0` were updated to `timeoutMs: 1` + a real-clock caller delay — `0` is now invalid-by-design (defaults apply).

## Round 15 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | `pendingStates` validated on shape only — a typo'd (`"queud"`) or narrowed (`["filled"]`) list false-settles while an order is still transitional | Runner unions caller states with `DEFAULT_SETTLE_PENDING` (widen-only; narrowing can never under-wait). Constant moved to `probe-manifest.ts`; loader warns on entries outside the vocabulary |
| M | `settlePoll` re-resolved `{...entry.args, ...spec.args}` post-fire — env drift between gate-confirm and poll rescoped the query (pending order invisible → false-settle) | All poll args pinned at the pre-flight resolution; post-fire resolution kept only for missing-var detection + scrub-set widening. Verified by a drift regression test (env flips A→B post-fire; poll still queries A) |
| L | `positive()`/loader had no upper bound — `intervalMs: 3e9` clamps to ~1ms in Node (hot loop hammering a live API); `timeoutMs: 1e15` makes the fail-closed prompt unreachable; same class unguarded on `paceMs`/`backoffMs` | `bounded(v, fallback, max)` clamps all four (`intervalMs`≤60s, `timeoutMs`≤10m, `paceMs`/`backoffMs`≤30s) |
| L | `scrubResponse` scrubbed the JSON-*serialized* text — a secret containing `"`/`\` survives in escaped form | Leaf-walk scrub: every string value scrubbed raw before persistence |
| L | Cyclic `entry.args` (injectable caller) → unbounded `resolveEnvArgs` recursion escapes `runProbePlan` outside the `try` — no capture/checklist | `WeakSet` cycle guard; cycles degrade into the normal catch path (aborted run + capture attempt) |
| L | `settle.args` validated standalone-complete — a partial override relying on probe-arg merge was rejected | `validateToolArgs` runs on `{...probe.args, ...settle.args}` (what the poll actually sends); unknown-key check stays scoped to `settle.args` |
| L (info) | No warning when a probe arg key is also a settle-tool param without an override — silently scopes the poll | Loader warns per collision on mutation probes; real manifest declares the collision explicitly via `settle.args` |

Manifest updated: `mut-eq-market-buy-01.settle.args` now explicitly pins `account_number`/`symbol` (documents the intended poll scope).

## Round 16 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | Round-15 `scrubResponse` leaf-walk scrubbed values but not KEYS — a response keyed by a resolved env value (account-keyed maps, error bodies keyed by the offending arg) persisted the raw secret (round-15 regression) | Keys scrubbed too: `out[scrub(k)] = walk(x)` |
| L | `resolveEnvArgs` WeakSet returned the raw unresolved node on revisit — a shared (DAG) subtree's second reference carried the literal `$ENV:` placeholder into sent args | `WeakMap<object, resolved>` — register the output container before recursing; shared subtrees get the resolved node, cycles get a resolved cyclic copy |
| L | `collectEnvPlaceholders` had no cycle guard — a cyclic `data:` object escaped `validateProbeManifest` as a `RangeError` instead of an error result | WeakSet guard (skip revisited nodes) |
| L | Collision check used `in` — prototype-chain keys (`toString`, `constructor`) could false-trigger or suppress warnings | `Object.hasOwn` (matches `unknownArgKeys`) |
| L (hardening) | Per-entry scrub covered only that entry's env values — a response echoing a DIFFERENT probe's resolved value persisted it raw | `globalSecrets` — union of every planned probe's `requiredEnv` values — joins the scrub set (main loop + settle) |

## Round 17 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | Read/settle calls still validated args against the BUNDLED catalog — round 1 fixed only the mutation path; a live-only param would be silently stripped by ajv `removeAdditional` (probe records coverage never exercised; on the settle path a stripped scope param could mis-scope the poll) | `ExecuteObservationToolOptions.definition` — the CLI passes the live tools/list definition; bundled catalog remains the fallback for non-CLI callers |
| L | `out[scrub(k)]` overwrote on mask collision (two secrets → same `••••`) and a `__proto__` key silently dropped via prototype assignment — capture fidelity falsified in the fail-safe direction | `Object.defineProperty` own-property writes + `~N` collision suffix in `scrubResponse`; `defineProperty` in `resolveEnvArgs` |
| L | `e.requiredEnv` dereferenced unguarded in the `globalSecrets` build — non-array/absent from an injectable caller threw or iterated chars | `Array.isArray` + per-item `typeof` guard |
| L | `SAFE_PROBE_ID.test(e.id)` coerced non-strings — `id:123` and `id:"123"` both pass and collide in `seenIds` → capture overwrite | `typeof` check first |

## Round 18 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | Settle vacuously settled on shapeless success bodies — `{detail: 'Not found'}` (usable parsed, no list container, no `state`) → `pending=[]` → `settled` while the order may still be transitional | `settled` now requires positive order evidence: `extractOrderList(source) !== null \|\| Array.isArray(source) \|\| containsOrderState(source)` — anything else is inconclusive → timeout → operator |
| L | `maskResolvedArgs` still used plain `out[k] =` — a `__proto__` arg would vanish from the mutation consent display while still being sent | `Object.defineProperty` |
| L | `options.definition` never verified against `toolName` — a shared `executorOptions` bag could mis-validate every tool | Executor returns VALIDATION error on name mismatch |
| L | `redactValue` used `redacted[childKey] =` — `__proto__` keys in JSON.parse'd server responses silently dropped | `Object.defineProperty` |
| L | `SettleRecord.pendingStates` persisted unscrubbed — an injectable caller composing states from env values leaks to disk | `maskedStates()` scrubs the recorded list at all three record sites |
| L | Non-string `entry.tool` / non-object entry crashed `isMutation` OUTSIDE the try — mid-run rejection, no capture/checklist | Pre-flight shape check: entry object + string tool + plain-object args |

Regression tests: shapeless settle body never settles; a single terminal-state order object settles (positive evidence); empty `results: []` list settles.

## Round 19 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | Round-18 `containsOrderState` accepted ANY `state`/`status` string — `{status:'ok'}`/`{status:'error'}` health/error bodies became "order evidence" → false-settle (round-18 regression) | Evidence restricted to the known order-state vocabulary (`KNOWN_ORDER_STATES` = pending ∪ `TERMINAL_ORDER_STATES`, exported from probe-manifest) |
| L | `state ?? status` shadowing — a pending `status` could hide behind a terminal-looking `state` | `orderStateValues` checks BOTH fields in `findPendingOrders` and `containsOrderState` |
| L | Malformed caller `{success:false}` with non-string/missing `error` crashed `scrub` → full-run abort instead of per-probe error | `typeof` guard → `'unknown error'` |
| L | `findPendingOrders` lacked the cycle guard `containsOrderState` has | WeakSet added |
| L | Executor `options.definition.name` non-string → `stripServerPrefix` throws instead of returning a VALIDATION result | `typeof` guard first |

## Round 20 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | Settle poll ran only on `cap.outcome === 'success'` — a mutation that timed out mid-flight (server may have accepted) followed by operator 's' proceeded to the next probe with NO settle check and no checklist | Settle runs after ANY attempted mutation (`cap.latencyMs !== undefined`) — a failed-but-possibly-placed order still gets polled to timeout/abort |
| L | `result.toolError` non-string (contract-violating injectable caller) crashed `scrub` mid-loop → full-run abort | `typeof` normalize → `'unknown tool error'`; same guard on settle's `failureText` |
| L | `options.definition: null` slipped past the name check → `TypeError` instead of a VALIDATION result | `!= null` |
| L | `partially_filled_rest_cancelled` missing from terminal vocabulary — a single-order body in that real RH state could never settle | Added to `TERMINAL_ORDER_STATES` |
| L | Order evidence still content-blind — `{meta:{status:'cancelled'}}` or `[{unrelated:true}]` counted as evidence | `containsOrderState` requires an order-id key (`id`/`order_id`/`ref_id`) alongside a known state; bare arrays need an order-evidenced element (empty still counts — a legit empty list) |
| L | `entry.redactFields` type-trusted — a non-array from an injectable caller crashed the redactor AFTER the real call fired | Pre-flight shape check covers `redactFields` |

Regression tests: failed mutation still settle-polls; `partially_filled_rest_cancelled` single order settles; `{meta:{status:'cancelled'}}` wrapper is inconclusive.

## Round 21 — residual findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | `settle.tool` needed only "known non-mutation read" — a quotes tool (`get_equity_quotes`) returning `data.results` counted as order evidence → instant false-settle | `ORDER_LIST_TOOL` convention (`/^get_\w*orders?$/`): loader `entryFail`s, `settlePoll` refuses for injectable callers |
| L | Resume after a failed mutation re-gates but shows the plain gate prompt — the "order may already be live" warning existed only on the in-run retry path | Standing caution on every mutation gate (`verify no live order exists first`) + checklist line clarifies `--from` re-executes the probe through a fresh gate |
| L | `redactValue`'s `SAFE_IDENTIFIER_FIELDS` allowlist silently defeated explicit `extraFields`/`redactFields` (e.g. `redactFields: ["order_id"]` never redacted) | Explicit requests evaluated before the allowlist |
| L | `canceled` (single-L, used by live crypto-orders vocabulary) missing from terminal states | Added to `TERMINAL_ORDER_STATES` |
| L | Injectable `knownTools` entry missing `inputSchema` crashed the validator (`undefined.properties`) instead of returning an error result | `toToolMap` normalizes `inputSchema` to `{}` and skips name-less defs |

## Post-review housekeeping

- `tests/tsconfig.json` typecheck surfaced 44 latent type errors in the
  runner suite (invisible because `tsx --test` strips types): string
  literals vs `ToolExecutionErrorCategory` enum + missing `tool` on
  success literals. Fixed at the harness (`normalize()` injects `tool`);
  suite still 118/118, `tsc -p tests/tsconfig.json` clean for this file.
- Live smoke test against the real manifest: `--dry-run` plans correctly;
  `ro-accounts-01` executed live → redacted capture (`••••1655` masking);
  missing env → skip; mutation probe gated + declined without calling.

## Convergence

Twenty-one adversarial rounds; every finding resolved. Final state verified green after round 21.

Informational: `executeObservationTool` will run any `ALL_ENABLED_TOOLS` member — a brand-new live mutation tool unknown to both classifiers could run unattended; residual risk of static classification is acknowledged. `flushGroup` prompt outside `try` fails safe.

## Evidence

- `npm run test:rh-agent-mcp-discovery` — **118/118** (runner, manifest, drift suites); `test:rh-agent-mcp-tools` 20/20; `test:rh-agent-mcp-api` 8/8; `test:rh-agent-mcp-boundary` 5/5
- `functions/scripts/verify/rh-mcp-runner-683.ts` — **6/6** (offline, mocked caller over the real manifest)
- verify 681 (9/9) + 682 (6/6) — green
- `npm run build` clean; `tsc --noEmit` clean for the change set (2 pre-existing `broker-order-adapter` errors are unrelated WIP)
- CLI smoke: `--dry-run`, `--only`, `--group`, `--from` error path all exercised
- Jest full suite — 162 suites / 2301 tests green

## Verdict

**PASS.** All four acceptance criteria conform: captures persist only manifest-form args + redacted responses (error text scrubbed), filters/resume work and error loudly, the mutation gate has no bypass and re-gates on retry, settle poll + abort checklist are mocked-verified. The gate is fail-closed end-to-end: validator (gate vs tool classification), runner (per-call prompt, re-gate on retry, fail-closed timeout), CLI (non-TTY → decline), executor (live-schema validation).
