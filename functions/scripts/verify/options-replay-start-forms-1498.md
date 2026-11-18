# Verification Guide — `optionsReplayStart` two-form request + snapshot (#1498)

Task [#1498](https://github.com/rinebob/rel-str/issues/1498) — the callable
boundary rewired to three mutually-exclusive identity forms: `{variantId}`
resolved via `getReplayVariant`, inline `{legs[], variantName?}` validated
by the SHARED `validateVariantLegs`, and legacy `{templateId}` resolved to
its 1-leg variant. Every accepted request stamps a self-describing
`variantSnapshot {variantId?, name, legs[]}` on the run doc so later
registry edits can't rewrite history. Inline-legs runs carry
`templateId: 'custom'` (no registry entry exists); registry-form runs carry
the resolved variant id.

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `functions/scripts/verify/options-replay-start-forms-1498.ts` | request validation + registry resolution + doc write + enqueue | **DRY (default):** `startReplay` with capturing fakes against the REAL registries — all three forms, snapshot shapes, leg normalization, rejection matrix. **LIVE (`--live`):** submits three real runs via `prodReplayStartDeps` (real Firestore write + real Cloud Tasks enqueue), polls each doc to terminal |

### Usage

```bash
cd functions
# DRY — no writes, no credentials:
npx tsx scripts/verify/options-replay-start-forms-1498.ts

# LIVE — writes real run docs + enqueues real tasks on prod:
NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs" GOOGLE_CLOUD_PROJECT=rel-str \
  npx tsx scripts/verify/options-replay-start-forms-1498.ts --live [--symbol SPY] [--start 2026-11-10]
```

`--live` needs ADC (`firebase login` / application-default credentials),
`GOOGLE_CLOUD_PROJECT=rel-str` (the task-queue client can't infer the
project from user ADC), and the IPv4 preload on this network. The script
pins `serviceAccountId` to the deployed function's account
(`rel-str-partner-caller-prod@…`) — the documented pattern for enqueueing
real tasks under user ADC.

**Flags:** `--live` enables the write stage; `--symbol <T>` (default `SPY`);
`--start <YYYY-MM-DD>` (default `2026-11-10`).

**Pass:** `0 FAIL` in the summary line; exit 0.

**Fail:** each violation prints `FAIL {label} — {detail}`; exit 1.

### What LIVE leaves behind

Three real run docs under `st-options-replay-runs/` (runIds embed
`_{SYMBOL}`): the `templateId` run **completes** under the deployed
pre-#1499 worker (backward-compat proof — it ignores `variantSnapshot`);
the multi-leg `variantId` and inline `legs` runs land **failed** with
`Unknown templateId …` — the expected terminal until #1499 teaches the
worker to read `variantSnapshot`. These are honest artifacts, visible in
the run list; the failed runs are recoverable via `optionsReplayRetry`
once #1499 ships, and removable via `optionsReplayDelete`. Repeated
`--live` runs accumulate three docs each — the docs are deliberately
left for evidence; delete them via the callable if the list clutters.

### Verified live (2026-11-17)

`38 pass, 0 FAIL` — 23 DRY + 15 LIVE. TemplateId run
`…_frjm88_SPY` → `completed`; variant/legs runs → `failed 'Unknown
templateId'`; all three `variantSnapshot` shapes persisted verbatim.
