# Verification guide — Task #848 (order-lifecycle capture)

Proves `captureLifecycleEvent` end-to-end against production through the
real seams (`createLifecycleCaptureDeps`): a seeded scratch carrier doc +
one synthetic `order-filled` event exercises the full ledger contract —
transactional claim → real capture pipeline → `capturedEvents` manifest →
`st-screenshots` index → dedup rerun is a no-op.

## Scripts

### `screenshot-capture-826-lifecycle.ts`

```
cd functions
npx tsx scripts/verify/screenshot-capture-826-lifecycle.ts [SYMBOL]
```

| Arg | Default | Values |
|---|---|---|
| `SYMBOL` | `GOOG` | any symbol with `symbol-data/` bars |

Requires ADC (`gcloud auth application-default login` or
`GOOGLE_APPLICATION_CREDENTIALS`).

**Side effects (left in place as run evidence):**

- Scratch carrier doc `st-screenshot-verify/826-lifecycle` (kind
  `engine-position`; safe to delete). Deleted + re-seeded at the start of
  each run so reruns capture fresh instead of deduping on the previous run.
- Index doc `st-screenshots/verify-826-lifecycle-verify-826-carrier-order-filled-order-filled`.
- Real objects under
  `gs://rel-str.appspot.com/st-trade-screenshots/{SYMBOL}/verify-826-lifecycle/`
  — timestamped, so each run adds one SVG + one PNG.

**Passing:** all checks print `✔`, exit 0. Verifies: outcome
`captured` with SVG+PNG paths under `{symbol}/{groupId}/`, each object
exists with the right `contentType`, the carrier doc's
`capturedEvents['order-filled']` entry is `{status: captured, claimedAt,
capturedAt, paths}` matching the outcome, the index doc carries the
deterministic `{groupId}-{refId}-{event}` id plus
positionId/refId/event/symbol/positionType/groupId/carrier/paths, and a
second invocation returns `skipped-duplicate` with no new objects and an
untouched index doc.

**Failing:** a `✖` line names the broken invariant; exit 1. ADC or
Firestore/bucket-permission failures surface as `verify failed` output.

**Note on the await cap:** the script overrides `timeoutMs` to 120s
(prod budget is 10s). Locally a capture runs ~15–30s — the data fetch,
SVG render, resvg rasterize, and two bucket writes have no same-VPC
warm path. The cap is caller-side accounting only (the detached capture
writes either way), so the override doesn't weaken what the intake
guarantees; it keeps the verify deterministic off-Cloud-Run.
