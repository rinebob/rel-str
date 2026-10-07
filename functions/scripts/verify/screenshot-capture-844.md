# Verification guide — Task #844 (grouped-capture contracts)

Proves the #826 contract additions end-to-end against production: `groupId`
adds a `{symbol}/{groupId}/` directory level so one campaign's captures list
under a single prefix, and the strategy `positionType` tags parse and flow
into the path.

## Scripts

### `screenshot-capture-844-contracts.ts`

```
cd functions
npx tsx scripts/verify/screenshot-capture-844-contracts.ts [SYMBOL]
```

| Arg | Default | Values |
|---|---|---|
| `SYMBOL` | `GOOG` | any symbol with `symbol-data/` bars |

Requires ADC (`gcloud auth application-default login` or
`GOOGLE_APPLICATION_CREDENTIALS`). **Writes real objects** to
`gs://rel-str.appspot.com/st-trade-screenshots/{SYMBOL}/verify-cohort-844/` —
the fixed timestamp (`2026-10-05-143022`) means reruns overwrite the same
objects.

**Passing:** all checks print `✔`, exit 0. Verifies: a grouped capture
writes `st-trade-screenshots/{SYMBOL}/verify-cohort-844/{date}-{time}-
order-filled-option-single-leg1-daily.{svg,png}`, the path matches
`buildScreenshotStoragePath` exactly, the object exists and round-trips
with `image/svg+xml`, the group prefix lists the capture, all four
`positionType` values parse (`stock`, `vertical-debit-spread`, `calendar`,
`option-single`), and a non-string `groupId` rejects with
`invalid-argument`.

**Failing:** a `✖` line names the broken invariant; exit 1. ADC or
bucket-permission failures surface as `internal`/`verify failed` output.
