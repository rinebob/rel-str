# Verify guide — #873 Pine AVWAP refinement + parity audit

## Script

`indicator-lib-873-pine-parity.ts` — static audit of
`rb-ps/rb-ta/ind/rb-st-anchored-vwap.pine`. Pine has no local compiler
(TradingView-only runtime), so this pins what is mechanically checkable:
the causal no-backfill contract, surviving-vertex supersession handling,
scaffold removal, the polyline/label budgets, the input surface, and the
#873 review fix-set. The manual TradingView-vs-web checklist is the
separate UAT leg (SHARED test plan).

## Usage

```powershell
cd functions
npx tsx scripts/verify/indicator-lib-873-pine-parity.ts
```

No arguments, no env, read-only, ~instant. Run from `functions/`.

## Passing result

46 `PASS` lines, summary `46 PASS / 0 FAIL`, exit code 0.

## Failing result

A `FAIL` line names the violated check. Two fix paths:

- **Scaffolding regression** (`plot(`, `plotshape(`, `table`, `debugOn`
  reappearing) — remove it from the `.pine` file.
- **Contract drift** (trigger scan-back range, draw-from-triggerBar,
  prefix-sum VWAP, supersession reconciliation, persist/era cap rules,
  drawing-lifecycle deletes, `xloc.bar_time`, the `> 1` point guards,
  input defaults) — either fix the `.pine` file to match
  `src/app/features/shared/components/flex-chart/indicators/st-anchored-vwap.engine.ts`,
  or update this audit's patterns in the same commit if the web contract
  intentionally changed.

## Known Pine divergences (documented, not audited)

- `historyStart` compares bar open epoch-ms vs `input.time`; the web
  compares session date strings — the boundary bar can differ by the
  exchange timezone (Pine `input.time` has no date-only mode).
- A polyline truncates silently at 10,000 `chart.point`s — a segment
  spanning more bars drops its tail (accepted edge).
- Per-bar arrays grow unbounded toward Pine's ~100k-element ceiling —
  same exposure as `rb-st-zigzag.pine`.
- Live/fan polylines rebuild every realtime tick (`drawSeg` on
  `barstate.islast`) — watch compute timeouts with Persist on very long
  intraday charts.
- `triggerY` uses the open unconditionally for a gap-through dot; the
  web falls back to the nearest bar extreme when open is non-finite
  (edge-only).
- No ZigZag leg overlay / developing leg — lines + dots only; parity
  with the web's *VWAP* surface, not its leg overlays.
- The TradingView manual compile + side-by-side compare is the remaining
  UAT leg — the audit cannot compile Pine or verify runtime/rendering.
