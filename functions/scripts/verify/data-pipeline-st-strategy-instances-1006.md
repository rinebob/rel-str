# #1006 — st-strategy-instances migration + re-point

**Task:** BE-IMPL: st-strategy-instances migration + re-point
**Pipeline stage:** persistence (instance config + `daily-analysis` subcollection)

## What changed

- `strategy-instance-repository` reads `st-strategy-instances` (canonical) —
  unioned with the legacy `paper-trading/instances/items` anchor so a
  Strategy-Builder create during the FE-write soak window (until #1014) still
  reaches the engine. On an id collision the doc with the **newer `updatedAt`
  wins** (FE stamps it on every write — a post-migration UI edit/pause on the
  anchor must not be shadowed by the migrated copy); a tie goes to canonical.
- `enabled: false` is the kill switch and `mode` scopes consumers — the paper
  engine only consumes `mode:'paper'` docs (list fns filter both; `getInstance`
  is a config read and does not filter).
- `daily-analysis` subcollection moved to
  `st-strategy-instances/{id}/daily-analysis` — open-pass reader/writer,
  overnight-simulation writer, and the position-repository userId txn read are
  all re-pointed.
- `paper-trading/repository.ts` `getInstance`/`setInstance` delegate to the
  engine repository (canonical + union fallback); `kind`/`id` are stripped on
  write — neither lives in the canonical payload.
- `deepEqual` treats NaN==NaN (Firestore stores NaN natively — legacy
  daily-analysis sims carry NaN `underlyingPrice` grid points).

## Migration script

`scripts/migrate-strategy-instances-1006.ts` — copies
`options-strategy-instances/{id}` (unioned with `paper-trading/instances/items`,
anchor wins a collision) into `st-strategy-instances/{id}` with `mode:'paper'`,
`enabled:true`, `paperAccountId` (existing or `buildAccountId(userId)`), ISO
timestamps, and no `kind`. The `daily-analysis` subcollection is carried
verbatim. Sources are never deleted (archive is #1013). Idempotent —
`set(merge)` with unchanged detection. On a rerun, canonical-managed fields
(`mode`, `enabled`, `paperAccountId`, `lastFiredAt`) are preserved — the
migration never reverts a kill-switch, mode promotion, or server-stamped
field. A `daily-analysis` subdoc that already exists canonically is only
overwritten when the legacy copy is provably newer
(`overnightDeltaSimulation.computedAt`); otherwise the divergence is WARNed
and canonical kept.

```
npx tsx scripts/migrate-strategy-instances-1006.ts           # dry-run
npx tsx scripts/migrate-strategy-instances-1006.ts --apply   # write
npx tsx scripts/migrate-strategy-instances-1006.ts --apply --id <instanceId>
```

Pass: `created/updated/unchanged` per doc + `analysisCopied` for subdocs.
Fail: `malformed`/`failed` lines with per-doc reasons.

## Verify script

`scripts/verify/data-pipeline-st-strategy-instances-1006.ts` — read-only audit
against prod.

```
npx tsx scripts/verify/data-pipeline-st-strategy-instances-1006.ts
```

FAILs on: missing canonical counterpart for a legacy doc, engine-field
divergence with **equal** `updatedAt` (soak drift — a UI edit on either side
bumps `updatedAt`, so the newer doc is authoritative → WARN), missing
`daily-analysis` carry-over, canonical da-docs that diverge while the legacy
copy is **newer** (stale canonical), invalid canonical shape
(mode/enabled/paperAccountId), or the repo seam (`listRunnableInstances`)
dropping a runnable doc or returning a non-runnable one. WARNs on
post-migration creates with no legacy source, soak/canonical-newer
divergence, and instances that never ran a selection pass.

Exit 0 = clean. Run after `--apply` and after the re-pointed functions deploy.

## Order

migrate → deploy → verify. Before the deploy, `listRunnableInstances` still
reads the old anchor — the audit's seam section stays correct either way
(union).
