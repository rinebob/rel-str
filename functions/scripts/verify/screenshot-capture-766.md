# Verification guide — Task #766 (SVG chart renderer)

Renders a deterministic render-model fixture through `renderChartSvg`,
asserts structural invariants, and writes the SVG to
`.devin/tmp/screenshot-capture-766/screenshot-766-daily.svg` for visual
inspection in a browser.

## Scripts

### `screenshot-capture-766-render.ts`

```
cd functions
npx tsx scripts/verify/screenshot-capture-766-render.ts
```

No flags or arguments. No Firestore/Storage access — the render stage is
pure; data assembly (#767) and persistence (#768) verify separately.

**Passing:** all 9 checks print `✔` and the process exits 0.
**Failing:** any `✖` line names the broken invariant; exit code 1.

The fixture covers every render path the quick-charts parity target needs:

- 3 candle series (2 trend-band layers behind 30 price candles)
- range fill + dashed/solid lines (std-dev language)
- scatter overlays (main uptick dots, lower signal/zone dots)
- column histograms incl. an HTF companion column behind the primary
- HTF window shading, reference lines, fixed + auto axes
- metadata header, amber event marker on the last bar, clip-paths,
  `data-plot-x`/`data-bar-width`/`data-bar-count` on the root

After the checks, open the written SVG and eyeball it against quick-charts:
dark surface, teal/red candles on top, band layers behind, dashed band
lines, axis labels on the right, indicator panes below the price pane.
