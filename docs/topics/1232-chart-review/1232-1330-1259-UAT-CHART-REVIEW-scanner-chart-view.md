**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1330  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1259  
**Domain:** CHART-REVIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

**Verdict:** PASS

# UAT — #1259 RH equity historicals + ChartStore tracked/untracked fork

Acceptance for the ephemeral-charts plumbing: untracked symbols chart from RH
`get_equity_historicals` bars while tracked symbols keep the full symbol-data +
indicator display.

## Evidence

| # | Scenario | Method | Result |
|---|---|---|---|
| 1 | `getEquityHistoricals` calls `get_equity_historicals` with `{symbols, start_time, interval, bounds:'regular', adjustment_type:'split'}` | client spec: `calls get_equity_historicals with symbols, start_time, interval, bounds + adjustment_type` | PASS |
| 2 | `end_time` passed through when provided | client spec: `passes end_time through` | PASS |
| 3 | Parsed `data.results` returned verbatim; `guide` + `interpolated` bars preserved | client spec: `returns the parsed data.results payload` | PASS |
| 4 | Tool failure → `RobinhoodMcpError` propagates | client spec: `throws RobinhoodMcpError when the tool call fails` | PASS |
| 5 | Malformed payload (missing `data.results`) → throws | client spec: `throws when the payload is missing data.results` | PASS |
| 6 | Wire bar → `OhlcBar` (`begins_at`→`d`, string prices→numbers) | service spec: `maps wire strings to OhlcBar numbers` | PASS |
| 7 | Interpolated bars kept (flag dropped, bar kept) | service spec: `keeps interpolated bars` | PASS |
| 8 | `loadBars$` fires day/week/month over ~10y, no end_time | service spec: `fires day/week/month calls for the symbol over a ~10y span` | PASS |
| 9 | Returns `{daily, weekly, monthly, version:''}` ChartDataset shape | service spec: `returns the three-interval shape with version ""` | PASS |
| 10 | Symbol absent from results → empty datasets, not a crash | service spec: `yields empty datasets when the symbol is absent` | PASS |
| 11 | Client rejection propagates (no silent blank) | service spec: `propagates client rejections` | PASS |
| 12 | Untracked symbol → RH path; `ChartService` never called; `loadIfNeeded` NOT called; `symbolDataVersion` stays `''` | store spec: `untracked symbol → RH path` | PASS |
| 13 | Tracked symbol + empty symbol-data (`version === ''`) → RH fallback | store spec: `tracked symbol with empty symbol-data falls back to RH` | PASS |
| 14 | Tracked symbol + real bars → symbol-data path, no RH call, indicators load | store spec: `tracked symbol with real bars stays on the symbol-data path` | PASS |
| 15 | RH error → store error state | store spec: `RH errors surface as store error state` | PASS |
| 16 | Empty tracked universe (list never loaded — QuickCharts/galleries) → symbol-data first, pre-fork behavior | store spec: `empty tracked universe takes symbol-data first` | PASS |
| 17 | Rapid symbol switching cancels in-flight RH load (`barsSub`) | store spec: `rapid switching cancels an in-flight RH load` | PASS |
| 18 | Stale response after cancellation can't overwrite newer selection | store spec: `ignores a stale response` | PASS |
| 19 | `symbolDataVersion` blanked while new symbol's bars in flight | store spec: `blanks symbolDataVersion while a new symbol loads` | PASS |

## Suite evidence

`npx jest rh-chart chart.store robinhood-mcp-client --coverage=false` →
**134/134** across 4 suites (17 new specs: 5 client, 6 service, 6 store).
`tsc --noEmit -p tsconfig.app.json` clean. NG0914 zoneless warnings are
existing test-env noise.

## Traceability

| AC | Scenario(s) |
|---|---|
| Client method: tool/args, OhlcBar mapping, error propagation | 1–6 |
| `RhChartService.loadBars$` → three-interval shape, `version:''` | 8–9 |
| `loadCharts` forks on `trackedSymbols`; untracked skips `loadIfNeeded` | 12 |
| Tracked + empty symbol-data → RH fallback | 13 |
| Interpolated bars kept | 7 |
| Rapid switching cancels in-flight RH loads | 17–18 |
| Store/service specs per TEST-FE | all |

## Residuals

- **No live-data run verified** — the real check is `/trading/chart-view`
  with an untracked symbol selected: three D/W/M charts render from RH,
  indicator panes stay empty, switching symbols mid-load cancels cleanly.
- Indicator panes render empty for untracked symbols (PRD-intended —
  bar-derivable indicators only; page-level display is the consumer's concern).
- No session cache — re-selecting a symbol refetches (~3 RH calls).
