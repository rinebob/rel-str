**Topic:** Robinhood MCP
**Topic Slug:** robinhood-mcp
**Issue:** #712
**Task:** #682
**Blueprint:** #680
**Thread Parent:** #658
**Topic Parent:** #657
**Domain:** RH-MCP
**Type:** UAT
**Status:** Complete
**Created:** 2026-09-30
**Last Updated:** 2026-09-30

# UAT — #682 Drift check: live tools/list vs bundled catalog

## Scope

Task ACs: (1) drift check records added/removed/renamed tools; (2) records per-tool `inputSchema` diffs; (3) output feeds the discovery doc's drift section + sweep warns loudly on drift; (4) bundled catalog regenerated from live (49→76 tools).

## Prerequisites

- Repo at branch `prod`; Node 24; `cd functions` for script commands.
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` (IPv6 workaround).
- Scenarios 5–6 need a stored local RH credential (OAuth bootstrap) — same auth as `executeObservationTool`. The rest are fully offline.

## Scenarios

### 1. Offline drift-diff verify

```powershell
cd functions
npx tsx scripts/verify/rh-mcp-drift-682.ts
```

Expected: 6 checks `OK`, `6 passed, 0 failed`, exit 0. Covers: catalog loads, identical→no drift, added/removed + prefix normalization, schema+desc rename pairing, per-tool schema diffs (required/properties/type), runner + committed capture exist.

**Result:** PASS — `6 passed, 0 failed` (2026-09-30).

### 2. Drift unit spec

```powershell
npx tsx --test ../tests/functions/rh-agent-mcp-catalog-drift.test.ts
```

Expected: all `it` cases pass (added/removed/rename-pair/required/properties/type/enum/description/order-insensitive/rename-ambiguity/collision→hasDrift/proto-key/property-fallback cases).

**Result:** PASS — `pass 25, fail 0`.

### 3. Manifest validator regression (catalog regen safety)

```powershell
npx tsx scripts/verify/rh-mcp-manifest-681.ts
```

Expected: `9 passed, 0 failed` — the seed manifest still validates against the **regenerated** 76-tool catalog (all manifest tools present; strict arg check passes).

**Result:** PASS — `9 passed, 0 failed`.

### 4. rh-mcp regression suite + build

```powershell
npx tsx --test ../tests/functions/rh-agent-mcp-tool-registry.test.ts ../tests/functions/rh-agent-mcp-redactor.test.ts ../tests/functions/rh-agent-mcp-tool-executor.test.ts ../tests/functions/rh-agent-mcp-probe-manifest.test.ts ../tests/functions/rh-agent-mcp-catalog-drift.test.ts
npm run build
```

Expected: all specs green; esbuild `Done`.

**Result:** PASS — 67/67 specs; build clean (`lib\index.js` 1.7mb).

### 5. Live drift check — real tools/list (needs RH credential)

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx src/rh-agent-mcp/diagnostics/run-drift-check.ts
```

Expected: connects via stored credential, prints tool counts, writes `docs/topics/657-rh-mcp/captures/00-drift.json` + `01-live-tools-list.json`. On the post-refresh catalog it reports `NO DRIFT`; a drifted baseline prints `*** DRIFT DETECTED ***` with added/removed/rename/changed detail (loud sweep warning).

**Result:** PASS — ran 2026-09-29 pre-refresh: live=76 vs catalog=49, `*** DRIFT DETECTED ***` with +27 added + 37 changed tools; both captures written. Re-ran post-refresh during review: `0 added / 0 removed / 0 changed` — confirms the catalog is current.

### 6. Catalog refresh (needs RH credential)

```powershell
npx tsx src/rh-agent-mcp/diagnostics/refresh-tool-catalog.ts --dry-run   # preview, no write
npx tsx src/rh-agent-mcp/diagnostics/refresh-tool-catalog.ts             # write
```

Expected: dry-run prints `prior catalog: N | live: 76` + added/removed/changed counts without writing; real run writes `.rh-mcp-tool-catalog.json` (tmp+rename, refuses empty live list). Regenerated file: `{generated: "2026-09-30", source: "live tools/list via refresh-tool-catalog.ts", tools: [76]}`.

**Result:** PASS — dry-run `added 27, removed 0, changed 37`; real run wrote 76-tool catalog; post-regen dry-run `added 0, removed 0, changed 0`.

### 7. Drift capture content sanity

Open `docs/topics/657-rh-mcp/captures/00-drift.json`: fields `generatedAt`, `catalogGenerated: "2026-07-17"`, `liveToolCount: 76`, `catalogToolCount: 49`, `added` (27 names), `removed: []`, `possiblyRenamed: []`, `changed` (37 entries with leaf diffs like `+properties.direction` on `place_option_order`), `unchanged` (12), `hasDrift: true`. `01-live-tools-list.json` = full raw schemas for all 76.

**Result:** PASS — inspected; matches structure the doc assembler needs.

### 8. Registrations

`scripts/verify/README.md` row for #682 → guide `rh-mcp-drift-682.md`; `run-all.ts` entry `rh-mcp catalog drift (offline)` with `cwd: 'functions'`, no credential flags; `functions/package.json` test script unchanged-correct.

**Result:** PASS — inspected.

## Traceability

| AC | Scenarios |
|---|---|
| Added/removed/renamed recorded | 1, 2, 5, 7 |
| Per-tool inputSchema diffs | 1, 2, 5, 7 |
| Feeds drift section + sweep warns loudly | 5 (banner + capture), 7 |
| Catalog regenerated from live | 3, 4, 6 |

## Regression checklist

- [x] rh-mcp suite green post-regen (allowlist still gates to original 49) — scenario 4
- [x] Manifest verify green — scenario 3
- [x] Build green — scenario 4
- [x] Full Jest suite 161/161, 2238/2238 — run during review
