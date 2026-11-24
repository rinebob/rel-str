# Verify — paper-trading-signal-review-retire-1652

Verification for the auto-mint retirement (task #1652 — BE-IMPL:
auto-mint retire, Thread #1117). The retirement mechanism is config —
`st-config/autoPaper.enabled = false`; `runAutoPaperIngestPass` +
`runAutoPaperIngestFill` stay deployed-inert with no code changes.

## Ops flip (user-executed, one-time)

Console: `st-config/autoPaper` → set `enabled` to `false` (keep
`lists`/`signalTypes`/`ownerUid` — reversible).

Or script (one-liner, ADC required):

```bash
# repo root — temp script lands in the gitignored .devin/tmp/
mkdir -p .devin/tmp
cat > .devin/tmp/flip-autopaper-1652.ts <<'EOF'
import { db } from '../../functions/src/firebase-admin-init';
import { ST_CONFIG_ROOT, AUTO_PAPER_CONFIG_DOC } from '../../functions/src/common/st-collections';
await db.collection(ST_CONFIG_ROOT).doc(AUTO_PAPER_CONFIG_DOC)
  .set({ enabled: false }, { merge: true });
console.log('autoPaper.enabled -> false');
EOF
npx tsx .devin/tmp/flip-autopaper-1652.ts && rm .devin/tmp/flip-autopaper-1652.ts
```

## Commands

```bash
cd functions

# DRY — fixture configs through the real runAutoPaperIngestPass
npx tsx scripts/verify/paper-trading-signal-review-retire-1652.ts

# LIVE — real doc read + post-wipe census + real gate call (needs ADC)
GOOGLE_CLOUD_PROJECT=rel-str npx tsx scripts/verify/paper-trading-signal-review-retire-1652.ts --live
```

## Flags

| Flag | Effect |
|------|--------|
| (none) | DRY only — fixture deps through the real gate function. |
| `--live` | Adds the prod doc/census/gate block (read-only). |

## Pass criteria

- **DRY** — `enabled:false` → `skipped/'disabled'`; `enabled:true` +
  nightly + live date → `ready` (discriminating, not vacuous); missing
  config → `skipped/'missing-config'`; `enabled:false` wins even on a
  historical date (the config gate precedes the market-date gate).
- **LIVE** — `st-config/autoPaper.enabled === false`; zero
  non-accept-flow `source==SIGNAL` trades (post-#1651 wipe — the 27
  accept-flow docs are preserved and reported); the real gate returns
  `skipped/'disabled'` for a nightly payload — a dispatched ingest
  returns before creating the MCP session, quoting, or minting.

## Notes

- The LIVE block is read-only — it asserts state; it does not flip the
  config (the flip is the manual ops step above).
- `enabled:false` vs in-flight task runs: a Cloud Tasks dispatch already
  enqueued before the flip can still mint — the gate check above is the
  proof the retirement took effect; the last pre-flip dispatch is the
  only race window (IMPL-doc risk note).
- Physical removal of the task + pass is deferred cleanup — out of this
  thread's scope per the IMPL doc.
