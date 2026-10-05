# Verification guide — Task #768 (captureChartSnapshot callable)

Runs the real callable handler end-to-end against production: spec
validation → Firestore `symbol-data/` bars → indicator series → render
model → SVG → **real write into the default Storage bucket** → `exists()`
+ content round-trip + contentType. Also exercises the error contract and
deterministic-path repeat capture.

## Scripts

### `screenshot-capture-768-callable.ts`

```
cd functions
npx tsx scripts/verify/screenshot-capture-768-callable.ts [SYMBOL]
```

| Arg | Default | Values |
|---|---|---|
| `SYMBOL` | `GOOG` | any symbol with `symbol-data/` bars |

Requires ADC (`gcloud auth application-default login` or
`GOOGLE_APPLICATION_CREDENTIALS`). **Writes real objects** to
`gs://rel-str.appspot.com/st-trade-screenshots/{SYMBOL}/` — that is the
artifact store this pipeline exists to populate. The fixed timestamp
(`2026-10-05-143022`) means reruns overwrite the same objects.

**Passing:** all checks print `✔`, exit 0. Verifies: inline `svg` +
`paths` + `artifacts` result shape, storage path convention
(`st-trade-screenshots/{SYMBOL}/{date}-{time}-manual-stock-verify-{interval}.svg`),
both objects exist and round-trip byte-identical, `image/svg+xml`
contentType, deterministic identical paths on repeat, and the error
contract (`invalid-argument` on a fieldless spec, `unauthenticated` with
no auth context, `failed-precondition` on a symbol with no bars). The
script passes a synthetic `auth.uid` — real callers must be signed in.

**Failing:** a `✖` line names the broken invariant; exit 1. ADC or
bucket-permission failures surface as `internal`/`verify failed` output.
