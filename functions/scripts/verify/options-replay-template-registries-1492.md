# options-replay-template-registries-1492

Verification guide for **#1492 — SHARED Task: Template-shape + named-variant registries** (Topic #1238 Options Backtest, Thread #1270 Multi-leg Templates).

## What it verifies

The task's runtime-visible change: `shared/options-replay-templates.ts` became a two-registry model — `REPLAY_TEMPLATE_SHAPES` (generic legs + delta/DTE bands) and `REPLAY_VARIANTS` (concrete named legs) — with `REPLAY_TEMPLATES`/`getReplayTemplate` derived from the 1-leg variants as the legacy read surface. Three legs, all read-only:

1. **Registry structure** — every `REPLAY_TEMPLATE_SHAPES` entry resolves via `getTemplateShape`, has ≥1 leg; option legs carry `type`/`side`/`deltaBand`/`dteBand`, stock legs carry none; no shape leg carries concrete `targetDelta`/`dte`; every band value falls on the pick-doc grid (`PICK_GRID_DTES`, Δ step 5 within [5,95]); every `REPLAY_VARIANTS` option leg is on-grid with sign matching its type; ids unique across shapes and variants.
2. **Migration parity** — the derived `REPLAY_TEMPLATES` reproduce the four legacy entries (`csp-45-20`, `csp-30-30`, `lc-30-20`, `lc-45-15`) verbatim — name, description, side, coordinate — each resolvable via `getReplayTemplate`, `getReplayVariant`, and `legToPickDocCoordinate`.
3. **Prod compat** — every `st-options-replay-runs` doc's `templateId` resolves via BOTH `getReplayTemplate` (legacy surface) and `getReplayVariant` (new surface) — no prod run references an id the new registry can't serve.

## Usage

```powershell
cd functions
npx tsx scripts/verify/options-replay-template-registries-1492.ts [--run <runId>]
```

| Flag | Values | Meaning |
|------|--------|---------|
| `--run <runId>` | a `st-options-replay-runs` doc id | audit a single run doc instead of the whole collection |

Requires Application Default Credentials. Read-only — never writes.

## Pass / fail

- **Pass**: `AUDIT PASS` — `PASS registry structure` + `PASS <id>` per legacy template; `0 FAIL` in the summary.
- **Fail** (exit 1): a shape off-grid or missing legs, a duplicate id across registries, a legacy id that fails to resolve or whose fields drifted, or a prod run doc whose `templateId` misses either accessor.
- **WARN** (does not fail): a variant `structure` with no matching shape (`'custom'` is expected), legacy multi-symbol run docs, empty runs collection, `--run` matching no run doc.

## Setup / teardown

None — read-only audit, no seeded data. The registry legs run with zero run docs; Leg 3 degrades to a WARN when the collection is empty.
