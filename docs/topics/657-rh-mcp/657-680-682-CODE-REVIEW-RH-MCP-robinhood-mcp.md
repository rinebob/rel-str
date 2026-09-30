**Topic:** Robinhood MCP
**Topic Slug:** robinhood-mcp
**Blueprint:** #680
**Task:** #682
**Issue:** #682
**Domain:** RH-MCP
**Type:** CODE-REVIEW
**Reviewed:** 2026-09-30
**Result:** PASS (4 rounds — converged to no new findings)

# Code Review — #682 Drift check + catalog refresh

Axes: Standards (repo conventions, smell baseline) · Spec (task body + PRD/IMPL/TEST fit) · Thermo-nuclear (whole-change protocol).

## Round 1 — findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| M | run-drift-check wrote `00-drift.json` twice | Deleted dup block |
| M | `canonicalize` kept array order → `enum`/`type` reorder = phantom "schema changed" | Primitive arrays sort under set-valued keys |
| M | Rename pairing first-match, schema-only | Keys on schema+description; emits **all** candidates |
| M | Prefixed+unprefixed dup silently deduped | `nameCollisions[]` on the result |
| M | refresh: false comment, no empty-list guard, non-atomic write | Comment fixed; `live.length===0` throws; tmp+rename |
| L | Dead `checkCatalogDrift` + duplicated fetch | `fetchLiveToolList` returns raw names; runner uses it; dead export gone |
| L | Root-level inputSchema changes invisible | Catch-all `root changed beyond…` diff |
| N | Split imports, `get()!`, weak capture assert, doc date | All fixed |

## Round 2

| Sev | Finding | Resolution |
|---|---|---|
| M | `nameCollisions` not deduped, absent from `hasDrift`, never printed | Dedup+sort via single-pass Map; in `hasDrift`; `collide:` line in runner |
| M | refresh `rename` — orphan `.tmp` + bare retry | Retry only on EPERM/EBUSY; second failure error carries both messages; `finally` cleans tmp |
| L | `additionalProperties` object compare (`[object Object]` phantom) | `canonicalize` comparison + JSON render |
| L | `type` leaf masked when added/removed alongside another leaf | Fires when either side defines `type` |
| L | Catch-all comment inaccuracy; rename message missing "+ description"; dead `??` fallbacks; import order | All fixed |
| — | Committed `00-drift.json` predates post-refactor emit shape | Kept intentionally — it's the discovery baseline (July catalog vs live); documented in `rh-mcp-drift-682.md` |

## Round 3

| Sev | Finding | Resolution |
|---|---|---|
| L | scalar `type` vs `["type"]` phantom diff | `typeArr()` normalization before compare |
| L | `key in tp` matched prototype props → double-report for `constructor`-named fields | `Object.hasOwn` |
| Info | rename retry swallowed first error | Both error messages preserved |
| L | `oneOf`/`allOf` reorder phantom; primitive-array sort could mask order-sensitive `default`/`examples` | Sorting now gated to `SET_VALUED_KEYS` (enum/required/type/oneOf/anyOf/allOf); non-set arrays keep order |
| L | deeper constraint change masked when a leaf diff fired | property fallback always runs on non-leaf keys ("other fields changed") |
| — | test gaps | collision→hasDrift, nested-required reorder, oneOf reorder, scalar↔array type, proto-named property, non-set array reorder, leaf+constraint — all covered (25 cases) |

## Gate run
- Drift+manifest specs: **49/49** (25 drift + 24 manifest); rh-mcp suite **67/67**; full Jest **2238/2238**
- Verify: drift **6/6**, manifest **9/9**; `functions` build clean
- `refresh-tool-catalog.ts --dry-run` post-regen: **0 drift vs live** — baseline stable

## Live evidence (2026-09-29/30)
`captures/00-drift.json`: live=76 / catalog=49 → +27 added, 0 removed, 37 changed (real deltas: `place_option_order.direction`, `review_option_order.direction`, `create_scan +columns/+scan_id`, `update_scan_config` drops required `sorting_*`). `captures/01-live-tools-list.json` = full live dump for the doc assembler. Regenerated `.rh-mcp-tool-catalog.json` = 76 tools, stamped 2026-09-30.

## Verdict
**PASS** — four rounds to convergence; final pass reported no blocking findings, two residual LOWs fixed in round 4. Follow-ons recorded in IMPL: runner (#683) must inject the live tool list into manifest validation; the read sweep (#684) needs `ALL_ENABLED_TOOLS` extended for the ~20 new read tools.
