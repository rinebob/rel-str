# options-replay-leg-contracts-1491

Verification guide for **#1491 — SHARED Task: Leg + variant + request/snapshot contracts** (Topic #1238 Options Backtest, Thread #1270 Multi-leg Templates).

## What it verifies

The task's runtime-visible change: `OptionsReplayPermutationPayload` shrank to `{runId, symbol}` — the worker now reads selection inputs off the run doc via a new `getRun` dep, and `legToPickDocCoordinate` is the single leg→coordinate derivation. Three legs, all read-only:

1. **Run-doc fields** — every new-model `st-options-replay-runs` doc carries non-empty `templateId` + `startDate` (the `getRun` view). Missing → the run would fail permanently on the next worker pass → FAIL.
2. **Coordinate parity** — `legToPickDocCoordinate` over the leg form of every `REPLAY_TEMPLATES` entry reproduces that template's `coordinate` — derivation proven on the real curated registry.
3. **Persisted chain** — for each completed run with a contract-list doc, the derived coordinate deep-equals the list doc's recorded `pickDocMeta.coordinate`.

## Usage

```powershell
cd functions
npx tsx scripts/verify/options-replay-leg-contracts-1491.ts [--run <runId>]
```

| Flag | Values | Meaning |
|------|--------|---------|
| `--run <runId>` | a `st-options-replay-runs` doc id | audit a single run doc instead of the whole collection |

Requires Application Default Credentials. Read-only — never writes.

## Pass / fail

- **Pass**: `AUDIT PASS` — registry parity lines print PASS per template; `0 FAIL` in the summary.
- **Fail** (exit 1): a run doc missing `templateId`/`startDate`, a registry template whose derived coordinate differs from its stored `coordinate`, or a completed run whose list doc's `pickDocMeta.coordinate` disagrees with the derivation.
- **WARN** (does not fail): run docs without `variantSnapshot` (expected until the writer stamps it in #1498), legacy multi-symbol docs, empty runs collection.

## Setup / teardown

None — read-only audit, no seeded data. The coordinate-parity leg runs with zero run docs; the run-doc legs degrade to a WARN when the collection is empty.
