# UAT — #681 BE Probe manifest format + loader/validator

**Topic:** Robinhood MCP (#657)
**Thread:** Full RH MCP Tool Discovery (#658)
**Blueprint:** #680 (BE)
**Task:** #681
**Issue:** #694
**Domain:** RH-MCP
**Type:** UAT
**Status:** Complete
**Created:** 2026-09-29
**Last Updated:** 2026-09-29

## Results

| Scenario | Result | Evidence |
|---|---|---|
| S1 manifest load+validate | **PASS** | verify script: 9/9 OK, exit 0 |
| S2 negative gates | **PASS** | `mutation tool gated "read" is rejected` + `unknown tool is rejected` both OK |
| S3 unit spec | **PASS** | 24/24 via `tsx --test` |
| S4 dry-run plan | **PASS** | plan printed `[read]/[mutation] id - tool (group)` in manifest order |
| S5 registrations + build | **PASS** | `npm run test:rh-agent-mcp-discovery` green; esbuild bundle 1.6mb, exit 0 |
| S6 regression | **PASS** | `test:rh-agent-mcp-tools` 20/20 |

**Refinement pass:** Not applicable — no user-facing surface.

**Findings:** None.

## Scope

The probe-manifest subsystem: format (`{id, tool, args, group, gate, redactFields?, note?}`), `loadProbeManifest`/`validateProbeManifest` loader+validator, `formatProbePlan` dry-run printer, seed manifest, verify script + registrations. No user-facing surface — all verification is CLI.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, branch `prod`
- Node + `npx tsx` available (functions devDependency)
- No credentials, no MCP connection, no ADC needed — validation is offline

## Scenarios

### S1 — Manifest loads + validates against real catalog
- **Feature:** AC1 — manifest file loads and validates before any MCP call
- **Steps:** `cd functions; npx tsx scripts/verify/rh-mcp-manifest-681.ts`
- **Expected:** 9 checks `OK`, plan printed (3 seed probes), exit 0
- **Evidence:** see results below

### S2 — Negative gates reject bad manifests
- **Feature:** AC2 — unknown tool / duplicate id / invalid gate produce named errors; safety: mutation tool gated `read` is rejected (both static-set and flag-marked)
- **Steps:** same verify script — includes inline negative checks (mutation-gated-read, unknown tool)
- **Expected:** both negative checks `OK`
- **Evidence:** below

### S3 — Unit spec covers the validator surface
- **Feature:** all validator rules incl. edge cases (empty probes, non-object entry, missing args, unknown arg keys, malformed `$ENV:`, filename-safe id, server-prefixed names, patternProperties, requiredEnv annotation, over-gate warning)
- **Steps:** `cd functions; npx tsx --test ../tests/functions/rh-agent-mcp-probe-manifest.test.ts`
- **Expected:** all tests pass
- **Evidence:** below

### S4 — Dry-run plan output
- **Feature:** ordered `[gate] id - tool (group)` listing (the `--dry-run` printer; CLI flag itself is task #683)
- **Steps:** covered by S1 — plan printed mid-run
- **Expected:** one line per probe, gate bracket first, manifest order
- **Evidence:** below

### S5 — Registrations + build
- **Feature:** `npm run test:rh-agent-mcp-discovery` runs the spec; `run-all.ts` includes the verify script; README row present; functions bundle builds
- **Steps:** `cd functions; npm run test:rh-agent-mcp-discovery`; `cd functions && npm run build`
- **Expected:** spec runs green; build succeeds
- **Evidence:** below

### S6 — Regression: existing rh-agent-mcp tests
- **Steps:** `cd functions; npm run test:rh-agent-mcp-tools`
- **Expected:** 20/20 pass (registry, redactor, executor untouched but imported)

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Loads + validates before MCP | S1, S3 |
| Unknown tool / dup id / bad gate errors | S2, S3 |
| Cross-checks tool names (injectable; live list = #683) | S1, S3 |
| Ordered probe plan w/ gates (`formatProbePlan`; `--dry-run` flag = #683) | S4 |
| account_number never stored (`$ENV:` placeholders) | S1, S3 |
| Mutation-gate safety | S2, S3 |

## Regression checklist

- [ ] `test:rh-agent-mcp-tools` green (S6)
- [ ] `npm run build` green (S5)
- [ ] No changes to existing files beyond additive registrations
