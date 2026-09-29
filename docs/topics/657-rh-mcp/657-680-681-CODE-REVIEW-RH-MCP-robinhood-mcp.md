# Code Review — #681 BE Probe manifest format + loader/validator

**Status:** Complete — PASS (4 rounds; round 4 = no new findings)
**Topic:** Robinhood MCP (#657)
**Thread:** Full RH MCP Tool Discovery (#658)
**Blueprint:** #680 (BE)
**Task:** #681
**Domain:** RH-MCP
**Reviewed:** 2026-09-29

## Scope

New files only:

- `functions/src/rh-agent-mcp/diagnostics/probe-manifest.ts` — manifest types + `validateProbeManifest` (sync, injected tool set) + `loadProbeManifest` (async, IO + catalog default) + `formatProbePlan`
- `tests/functions/rh-agent-mcp-probe-manifest.test.ts` — 17 `node:test` cases
- `functions/scripts/verify/rh-mcp-manifest-681.ts` + `scripts/verify/rh-mcp-manifest-681.md` — verify script + guide
- `docs/topics/657-rh-mcp/probe-manifest.json` — seed manifest (3 probes)
- Registrations: `functions/package.json`, `scripts/verify/run-all.ts`, `scripts/verify/README.md`

## Round 1 — findings + fixes

### Thermo-nuclear

- **Major (fixed)** — Two sources of truth for mutability. The gate check used only the static `isMutationTool(name)` set while ignoring `RobinhoodToolDefinition.mutation` on the injected (potentially live `tools/list`) definition. Fix: `definition.mutation === true || isMutationTool(tool)` — OR semantics so disagreement can only over-gate, never let a mutation run unattended. Regression test added (`flagged_only_mutation` fixture — a tool absent from the static set that errors when gated `read`).
- **Minor (fixed)** — Error-skip logic `errors.some(e => e.probeId === id)` was correct but oblique; replaced with a per-entry `entryFailed` boolean stating the invariant directly.
- **Minor (fixed)** — Test comment claimed `bogus_param` was rejected; actually `removeAdditional` strips it — the failure is the missing required `account_number`. Comment corrected.
- **Minor (fixed)** — Missing edge cases: added tests for empty `probes` array (valid-but-empty; verify script separately requires >0), non-object entries, missing `args`, and entries-empty-on-failure semantics.
- **Minor (checked, no fix)** — `ro-accounts-01` lacks `redactFields`: `account_number` is already in the redactor's `DEFAULT_SENSITIVE_FIELDS` + `/_account_number$/i` pattern, so default redaction covers it. Defense-in-depth `redactFields` still available per-probe.

### Standards

No hard guideline violations. Minors addressed:

- **Minor (fixed)** — `mkdtempSync(os.tmpdir())` writes to `%TEMP%`, which the repo's AGENTS.md temp-file rule forbids (Windsurf watcher prompts). Moved to repo-local `.devin/tmp/test-probe-manifest/`.
- **Minor (fixed)** — `as never` negative fixtures: the `entry()` helper now takes `Record<string, unknown>` so invalid literals compile plainly.
- **Nit (fixed)** — `tool!` non-null assertion → narrowed by the guard.
- **Nit (fixed)** — `test:rh-mcp-discovery` renamed `test:rh-agent-mcp-discovery` to match sibling spec prefixes.
- **Nit (accepted)** — `scoped()` embeds `[id]` in `message` while `probeId` is also a field — the prefix is load-bearing for CLI output; field stays for programmatic checks.
- **Nit (accepted)** — `redactFields`/`note` have no consumer until runner #683; justified — the manifest data file already uses them.

### Spec

- **AC "loads + validates before any MCP call"** — met (loader is pure IO + catalog; no MCP dependency).
- **AC "unknown tool / dup id / bad gate named errors"** — met (all tested).
- **AC "cross-checks against live tools/list"** — **partial, deferred to #683**: `knownTools` is injectable so the runner passes the live `tools/list`; standalone default is the bundled catalog. Live fetch is the drift-check (#682) + runner (#683) boundary, by design.
- **AC "`--dry-run` prints ordered probe list"** — **partial, deferred to #683**: `formatProbePlan` implemented + tested + exercised by the verify script; the `--dry-run` CLI flag lands with `run-probe-manifest.ts` (Phase-1 task 3). Recorded in #681.
- Scope additions beyond ACs (accepted, safety-aligned): `$ENV:` placeholder collection + `requiredEnv`, load-time arg validation via `validateToolArgs`, mutation-gate cross-check, over-gate warning.

## Round 2 — verification + new findings

- **Major (fixed)** — `toToolMap` keyed on raw tool names; a live `tools/list` carrying `mcp__robinhood-trading__` prefixes would have failed every entry as "Unknown tool". Fix: `stripServerPrefix` at map-build; regression test added.
- **Minor (fixed)** — Typo'd *optional* params passed silently: ajv's `removeAdditional` strips unknown keys, shrinking coverage without a peep (the exact failure mode IMPL calls out). Fix: `unknownArgKeys` — top-level keys not in `properties`/`patternProperties` error when `additionalProperties !== true`.
- **Minor (fixed)** — Malformed `$ENV:` strings (lowercase, empty, prefixed) passed as literals to the API. Now an error.
- **Minor (fixed)** — `id` never sanitized though it becomes `captures/{id}.json` — `SAFE_PROBE_ID` check added.
- **Nits (fixed)** — em-dash in plan output → ASCII `-`; stray `await` on sync calls removed.
- Round-1 fixes re-verified: OR-ed mutation gate confirmed fail-closed across the full flag×static-set×gate truth table.
- Noted for the record: the committed manifest is a 3-probe seed; full permutation enumeration rides with the Phase-2 session tasks (#684–687), not #681.

## Round 3 — verification + new findings

- **Minor (fixed)** — `unknownArgKeys` ignored `patternProperties` (would falsely reject legit keys on a live schema using them); now honored. Also widened: schemas that omit `additionalProperties` entirely still get the check when a `properties` map exists (ajv strips unknown keys at runtime regardless).
- **Minor (fixed)** — Test gaps for the new checks: nested malformed `$ENV` inside array args, `additionalProperties: true` allows extras, `patternProperties` accept+reject — all added.
- **Nit (fixed)** — `in` operator → `Object.hasOwn` for the properties check.
- **Info (documented)** — `$ENV:` placeholders only work for string-typed schema params; noted in the module header comment.
- **Info (accepted)** — a malformed regex inside a schema's `patternProperties` throws at load instead of returning `{ok:false}` — acceptable: the schema set is trusted input.

## Round 4 — verification

**No new findings.** All fixes verified in place; test file at 24 cases covering every check including both directions of `patternProperties` and nested `$ENV` malformedness.

## Test results

- `npx jest --coverage=false` — 160/160 suites, **2159/2159** pass
- `tsx --test rh-agent-mcp-probe-manifest.test.ts` — **24/24**
- `test:rh-agent-mcp-tools` (registry+redactor+executor regression) — 20/20
- `scripts/verify/rh-mcp-manifest-681.ts` — **9/9** checks against the real manifest + catalog

## Verdict

**PASS** — major finding fixed and re-verified in round 1; remaining items are accepted nits or deliberate deferrals to runner task #683.
