# CODE-REVIEW — RH-MCP: Discovery doc assembler (#688)

**Topic:** #657 — Robinhood MCP
**Thread:** #658 — Full RH MCP Tool Discovery
**Blueprint:** #680
**Task:** #688 — BE-IMPL: Discovery doc assembler
**Reviewed:** 2026-10-06
**Verdict:** **PASS** — 1 remediation round (4 majors, all closed and re-verified)

## Surface

- `functions/src/rh-agent-mcp/diagnostics/assemble-discovery-doc.ts` — pure assembler (manifest × captures × live `tools/list` × drift → markdown)
- `functions/src/rh-agent-mcp/diagnostics/run-assemble-discovery-doc.ts` — CLI wrapper
- `tests/functions/rh-agent-mcp-discovery-assembler.test.ts` — 12 unit tests (node:test)
- `docs/topics/657-rh-mcp/rh-mcp-tool-discovery-canonical-657-658-689.md` — emitted draft (~3,080 lines)
- `functions/package.json` — test-script wiring (remediation)

## Standards

Reviewed against `rel-str-coding-guidelines` and sibling diagnostics (`catalog-drift.ts`, `probe-manifest.ts`, `run-drift-check.ts`, `run-probe-manifest.ts`).

**Majors — fixed this round:**

- **`possiblyRenamed` shape mismatch** — local `DriftReport` declared `{catalog,live}`; real `ToolCatalogDrift`/`RenamedPair` emits `{from,to}` → every rename pair would render `` `undefined→undefined` ``. Latent today (drift `[]`). Fixed: `DriftReport` now `Partial<ToolCatalogDrift>` (guideline #2 — canonical type imported, not redeclared); render uses `from`/`to`; test fixture exercises a real pair.
- **Dead test suite** — `rh-agent-mcp-discovery-assembler.test.ts` was absent from `test:rh-agent-mcp-discovery` (explicit file list, no glob runner). Fixed: appended to the npm script; 130 tests run and pass.

**Minors — noted, deferred (cheap, non-blocking):**

- `safetyClass` ignores live `mutation`/`simulation` definition flags (two-authority pattern used elsewhere); a future unlisted live mutation tool would label "read-only". Zero impact today — all 76 live tools are in the static sets.
- `flag()` parser looser than sibling CLIs (trailing-flag → undefined; no `--help`); `tools`/`manifest` shape fallthroughs crash opaquely; sync `fs` vs siblings' `fs/promises`.
- Skipped-capture `reason` field not carried; `CATEGORY_ORDER` duplicates `TOOL_GROUPS` names (ordering fixed this round — unknowns now sort last, was the M-below).
- Escaping only defends param descriptions; `CaptureRecord`/`ManifestProbe`/`LiveTool` subsets redeclare sibling types (kept — decouples the doc contract; DriftReport was the one that bit).
- Emitted doc lacks proj-workflow header — expected; #689 hand-finishing adds it.

**Verified clean:** all four `robinhood-tools` imports exist and are used correctly (financial⊂mutation ordering right); field-tree builder correct on real data (`array<object>` merging, `null` unions, empty-array notation); doc emits only field names/types/descriptions/notes — never response values or resolved args (account numbers stay `••••` masked in captures); test conventions match suite.

## Spec

All 4 acceptance criteria **MET**, verified against the emitted artifact and raw inputs:

| AC | Result |
|---|---|
| Coverage matrix from manifest+captures join; gaps visible | 76 rows = live tool count; statuses verified vs real data (50 probed / 21 missing / 3 error-only / 1 unprobed / 1 declined) |
| Per-tool block: params, field tree, ≥1 capture link, notes | All 76 live tools sectioned under 9 domains; params from **live** inputSchema (union types prove it); field trees from success captures only; 233 capture links ↔ 233 files, zero broken/orphan |
| Drift section from `captures/00-drift.json` | Rendered: 76 live vs 49 catalog, 27 added, 37 changed |
| Emit to pinned filename | CLI defaults `--out` to `rh-mcp-tool-discovery-canonical-657-658-689.md` |

Gap degradation is correct: missing/unprobed/error-only statuses state evidence absence instead of fabricating.

## Thermo-nuclear

**Critical: none.** Pipeline reconciles exactly with real data (274 probes, 233 captures, all joins clean).

**Majors — fixed this round:**

- **Multi-paragraph tool descriptions truncated to first line** — silently dropped the most safety-critical content in the corpus (`exercise_option`'s confirm-first warning, `create_alert`'s condition matrix, `place_option_order`'s account requirements; ~13 tools affected). Fixed: full description emitted.
- **Dead test suite** — same finding as Standards; fixed.
- **`_No captures — missing probes._` factually wrong for `unprobed` tools** — `cancel_equity_order` has 10 authored probes. Fixed: message branches on probe presence ("authored but not yet executed" vs "missing probes").

**Also fixed:** unknown categories sorted last (was `indexOf === -1` → front-loaded `## Other` on next drift-added tool).

**Minors — noted for #689/backlog:** MAX_DEPTH truncation emits no marker; `array<unknown>` conflates "always empty" with "unknown element type"; error-shape fingerprint is truncated JSON boilerplate and never printed (only a count shown); skipped `reason` dropped; manifest-vs-live orphans not called out; CLI flag/entrypoint guards; nondeterministic `readdirSync` ordering; meta-file exclusion by exact filename.

**Nits:** notes duplicate between capture lines and Notes block (per-string dedup only); 160-char param-description truncation can slice `\|` escapes; uncaptured-probe count not surfaced; test could assert error-payload exclusion from field trees.

## Tests

`npm run test:rh-agent-mcp-discovery` → **130 tests, 0 fail** (manifest 60 + drift 16 + runner 42 + assembler 12). `tsc --noEmit` clean on the diagnostics files.

## Remediation log

| Finding | Severity | Disposition |
|---|---|---|
| `possiblyRenamed` shape (`undefined→undefined`) | major | Fixed — `Partial<ToolCatalogDrift>` + `from`/`to` render + real-pair fixture |
| Test suite not in npm script | major | Fixed — appended to `test:rh-agent-mcp-discovery` |
| Description truncation loses safety text | major | Fixed — full multi-paragraph descriptions emitted |
| Wrong "missing probes" message on `unprobed` | major | Fixed — branched on `probes.length` |
| Unknown categories sort first | minor | Fixed — `indexOf===-1 → CATEGORY_ORDER.length` |
| `as never` drift fixture | nit | Fixed — real `ToolCatalogDrift` literal |
| Remaining minors (flags, reasons, fingerprints, orphans) | minor | Deferred — recorded above for #689 polish |

**Verdict: PASS.** Findings list rides into QA for spot-check; minors are documented candidates for #689 hand-finishing.
