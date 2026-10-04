# Verification guide — Task #767 (chart data assembler)

Runs the real data path end-to-end on a live symbol: Firestore
`symbol-data/` bars → `computeSymbolIndicatorSeries` → `assembleRenderModel`
→ `renderChartSvg`, then validates structural invariants and writes one SVG
per interval to `.devin/tmp/screenshot-capture-767/` for visual comparison
against quick-charts.

## Scripts

### `screenshot-capture-767-assemble.ts`

```
cd functions
npx tsx scripts/verify/screenshot-capture-767-assemble.ts [SYMBOL] [BARS]
```

| Arg | Default | Values |
|---|---|---|
| `SYMBOL` | `GOOG` | any symbol with `symbol-data/` bars |
| `BARS` | `30` | bar count, or `all` for the full series |

Requires ADC (`gcloud auth application-default login` or
`GOOGLE_APPLICATION_CREDENTIALS`). Reads prod Firestore (`rel-str`) —
read-only, no writes.

**Passing:** all checks print `✔`, exit 0. For each interval it verifies:
model per interval, FE pane order (main → lower-3 → lower-2 → lower-1),
window slicing and index rebasing, band candles behind the price candle,
fixed lower-1 (±50) and lower-3 (±7) axes, deterministic render, and a
well-formed SVG with no `NaN`/`undefined`.

**Failing:** a `✖` line names the broken invariant; exit 1. A symbol with
missing `symbol-data` docs fails the "bars loaded" check.

Data-dependent counts (dot markers, window runs, zone points) print under
`Info:` rather than asserting — a real symbol may legitimately have zero
signals in a 30-bar window.

After the checks, open the written SVGs and compare against the live
quick-chart for the same symbol: trend-band layering behind price, std-dev
channel lines + fills, colored zone dots on the lower panes, trend-strength
histogram with HTF shadow bars and signal dots, green/red HTF window
shading behind price, and the dashed event marker on the last bar.
