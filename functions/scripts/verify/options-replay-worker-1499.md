# Verify guide — #1499 Position-row mapper + permutation worker

Script: `functions/scripts/verify/options-replay-worker-1499.ts` — run from `functions/`.

## What it proves

The `optionsReplayPermutation` worker's multi-leg data path: run doc's
`variantSnapshot` → per-option-leg pick-doc fetch (bounded parallel) →
atomic position-row join → `schemaVersion: 2` list doc with `legMetas[]`
→ run close-out. Covers the #1498-deferred `'custom'`/multi-leg path the
old worker rejected with `Unknown templateId`.

## Usage

```bash
cd functions

# DRY (default) — fake ReplayPermutationDeps through the REAL worker
# core + mapper. No credentials, no writes.
npx tsx scripts/verify/options-replay-worker-1499.ts

# LIVE — real run docs + prodReplayPermutationDeps: real SA pick-doc
# fetches, real Firestore list-doc writes, real run close-out.
NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs" \
GOOGLE_CLOUD_PROJECT=rel-str \
npx tsx scripts/verify/options-replay-worker-1499.ts --live
```

## DRY stage checks (15)

| Stage | Asserts |
|---|---|
| S1 2-leg join | one fetch per option leg, `schemaVersion:2`, `legMetas[2]`, position row `legs[2]` in declared order + sides, success close-out |
| S2 leg miss | `no-selection` row with `legMisses[0].legIndex === 1`, reason `miss` |
| S3 stock leg | zero extra fetch, declared order kept, `underlyingClose` from the option pick |
| S4 snapshot guards | missing → failed no fetches; malformed legs → failed naming `leg 0`; stock-only → failed "no option legs" |
| S5 coded 404 | failed doc names `leg 1` + coordinate; both fetches still attempted |

## LIVE stage cases

Real run docs (`verify-1499-*`) written to `st-options-replay-runs`,
then `runReplayPermutation` invoked locally with `prodReplayPermutationDeps`
(the Cloud Tasks hop is proven by the #1498 verify; this exercises the
worker's data path end-to-end). SPY @ startDate `2026-11-02`.

| Case | Designed terminal |
|---|---|
| `csp-45-20` legacy snapshot | `success` — strict; v2 1-leg doc, `legMetas[1]` |
| `pcs-45-20-5` | `success` if the corpus has both cells, else a designed `failed` naming the leg — `legMetas[2]` + atomic `legs[2]` rows on success |
| `cov-45-20` stock+option | same — stock leg resolves off real `underlyingClose` on success |
| `custom` inline legs | same — the #1498-deferred path; `templateId` persists as `custom` |
| missing `variantSnapshot` | `failed` — pre-model/hand-built run doctrine, message names `variantSnapshot` |

Each case asserts the list doc landed, the terminal status is a designed
one, and the run doc closed out to the matching status (`completed` /
`failed`). Live docs are left in place as evidence (`verify-1499-*`
prefix — greppable; the retry callable can re-drive failures).

## Pass / fail

- PASS: `N pass, 0 FAIL` (15 dry + ~27 live asserts when the corpus
  has all cells).
- FAIL: any `FAIL` line — a non-designed terminal, a missing doc, or a
  shape violation. Corpus gaps surface as designed `failed` runs with
  the leg named in `error`, not FAILs.
