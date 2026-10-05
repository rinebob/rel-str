# Verification guide — Task #769 (PNG rasterization)

Proves the callable now writes a PNG sibling for every SVG: real
`@resvg/resvg-js` rasterization with the bundled Roboto TTFs, real objects
in the default Storage bucket, correct pixel dimensions, and
`image/png` contentType.

## Scripts

### `screenshot-capture-769-rasterize.ts`

```
cd functions
npx tsx scripts/verify/screenshot-capture-769-rasterize.ts [SYMBOL]
```

| Arg | Default | Values |
|---|---|---|
| `SYMBOL` | `GOOG` | any symbol with `symbol-data/` bars |

Requires ADC (`gcloud auth application-default login` or
`GOOGLE_APPLICATION_CREDENTIALS`). **Writes real objects** to
`gs://rel-str.appspot.com/st-trade-screenshots/{SYMBOL}/` — the same
objects the #768 script writes, now with `.png` siblings.

**Passing:** all checks print `✔`, exit 0. Verifies: bundled font files
resolve from the functions cwd, every artifact carries `pngPath`,
`paths` interleaves `[svg, png]` per artifact, each PNG exists, downloads
with a PNG signature, IHDR dimensions are the spec's 800×560, body is
non-trivial (> 10KB — proves text/shapes rasterized, not a blank frame),
contentType is `image/png`, and the SVG sibling still exists.

**Failing:** a `✖` line names the broken invariant; exit 1. A missing
font bundle fails the first check with the searched paths; resvg/native
failures surface as `internal`/`verify failed` output.

**Manual follow-up:** open the two PNGs (console bucket browser, or
`gcloud storage cp` to a local file) and confirm chart text is legible —
the bundled-font AC is visual.
