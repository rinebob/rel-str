**Topic:** RH Scanner  
**Topic Slug:** savant-trader  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1302  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1308  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# Code Review — #1308 FE-IMPL: untracked candle chart + on-demand bars store

## Verdict

**PASS** — after in-gate remediation of three major findings.

```text
First pass complete — 3 axes: 3 majors (canonical-path duplication, reauth dead-end, duplicated body forks), ~12 minors/nits
Second pass complete — remediation verified on the final diff; canonical-path conformance re-traced end-to-end (client gating, wire transform, PT-midnight x convention); no new findings
Convergence: PASS — every critical/major resolved and spec-pinned; remaining items are declared #1309 seams or documented judgments
```

## Scope reviewed

Uncommitted working-tree changes for #1308 (untracked candle chart +
on-demand bars store — fills the #1307 popup's `data-mode="untracked"`
body):

- `stores/scanner-chart.store.{ts,spec.ts}` (new)
- `utils/scanner-historicals.util.{ts,spec.ts}` (new)
- `pages/scanner/scanner-chart-popup.component.{ts,spec.ts}` (untracked fork)
- `pages/scanner/scanner-recipe-table.component.spec.ts` (store stub provider)

## Findings — first pass

### Standards axis

| Sev | Finding | Disposition |
|---|---|---|
| MAJOR | Store reimplemented `RobinhoodMcpClient.getEquityHistoricals` (#1259's canonical path for ephemeral untracked charts) — missed `adjustment_type:'split'`, `data.results` shape validation, `toolError`→`RobinhoodMcpError` gating | **FIXED** — store now calls `client.getEquityHistoricals([sym],'day',start)`; all gating inherited; ~25 lines deleted |
| MAJOR | Settled-error-terminal + no invalidation path — the popup's Re-authorize could never heal the view (settled `auth` slot blocks refetch forever) | **FIXED** — `clearError(symbol)` added; popup's `onReauth()` clears + re-ensures + emits; spec-pinned |
| MINOR | `historicalsToBars` forked a second wire→PriceBar transform while `equityWireBarToOhlc`+`ohlcToPriceBar` exist | **FIXED** — the util composes the canonical pair + malformed-row validation + the canonical sort; PT-midnight `x` convention inherited |
| MINOR | Missing sort — wire is captured ascending but not guaranteed | **FIXED** — `date.localeCompare` sort mirrors RhChartService |
| MINOR | `type:'sma'` has no registered calculator — works only via `config.data` passthrough | **FIXED** — `type:'custom'` (the union member documented "data provided externally") |
| MINOR | Symbol normalization hand-rolled in 3 places | **FIXED** — `normScanSymbol` in store + popup |
| MINOR | Template shells duplicated across forks | **FIXED** — one `bodyView` `@switch` (see TN #2) |
| — | Spec conventions clean: jest.fn(), macrotask flush, overrideComponent FlexChartStub with signal inputs (allowed — the decorator rule targets `jest.mock` hoisting), standard partial-double cast | Confirmed |

### Spec axis

| Requirement | Status |
|---|---|
| Session-scoped store; bars/loading/error per symbol; `ensureBars` dedupes; error settles terminal | MET |
| Fetch via the MCP seam | MET — via canonical `RobinhoodMcpClient` (stronger than the issue's literal executeTools call) |
| `historicalsToBars` — coerce strings, drop malformed, absent→[] | MET + spec'd incl. the `Number('')===0` footgun |
| `smaOverlays(bars,[10,20,50])` — 3 series, warmup-null head | MET + spec'd at hand-computed points |
| Popup: candle series + 3 MA lines, ~40-60 bars, no toolbar/dots, theme-token colors | MET — `visibleBars:60`, all chrome off; candle fills come from `palette().candleUp/Down`; MA line hexes are `colorRemap`-covered literals (#1216 convention — documented judgment under the narrow reading of "no hardcoded hex") |
| TEST-FE §4 spec coverage | MET — all bullets pinned |
| Tracked fork stays the infra shells for #1309 | MET + spec'd (`ensureBars` not called when tracked) |
| Disclosed deviation | Issue body's `{symbol, span:'year'}`/`arguments` shape is stale — the verified contract (`symbols[]` + RFC3339 `start_time` via `args`, response `data.results[]`) is used; deviation documented in #1304's captures |

### Thermo-nuclear axis

| Sev | Finding | Disposition |
|---|---|---|
| MAJOR | Reauth dead-end (same as Standards #2 — cross-axis convergent) | FIXED — `clearError` + `onReauth` clear/retry |
| MAJOR | Two body forks duplicated ~30 lines of identical shells; #1309 would fork it again | **FIXED** — single `bodyView` computed (`tracked→state`; untracked: non-loading input wins → store error → bars→chart/empty); #1309 is now a one-case diff |
| MINOR | Dead `error` input (never bound) | **FIXED** — input removed; error shells read `storeError` |
| MINOR | Malformed `res.parsed` would render 'empty' dishonestly | **FIXED** — client's `data.results` shape gate throws MCP error instead |
| MINOR | Feature Envy — popup reads three store maps keyed by `sym` | Accepted — one consumer; a `viewFor` API would be speculative |
| MINOR | Store spec gaps: `toolError` branch, whitespace-symbol guard | **FIXED** — `ensureBars(' ')`/empty no-op spec; toolError now belongs to the client's (already-tested) gate |
| NIT | `cat` dead condition; stale `@task #1307` header; "the rest scroll" comment wrong (scrollbar off); `ready` unused stub field | All FIXED |
| NIT | `interpolated` bars kept | Matches canonical `equityWireBarToOhlc` contract ("a synthesized bar beats a chart gap") |

## Test results

- **Full suite post-remediation: 6312/6312 green (332 suites).**
- savant-trader feature scope: **3636/3636 (181 suites)** — covers the
  popup, both new specs, `rh-chart.service` (now imported by the util),
  chart-view, and all consumers.
- New coverage: util spec (6 — parse/coerce/malformed/empty + SMA
  values/warmup/3-series + canonical `x` convention via `toDatePt`);
  store spec (8 — fetch args, in-flight dedupe, cache-hit, settled-error
  terminal, AUTH flag, **`clearError` re-arm**, whitespace guard,
  empty-results); popup spec additions (7 — ensure-on-mount, tracked
  untouched, candle+3-SMA config shape, store error/auth shells,
  **reauth clear+retry+emit**, empty note, loading).
- `tsc --noEmit`: clean on all task files (repo-wide pre-existing
  foreign errors unchanged: `scripts/bulk-swing-sweep.ts`,
  `portfolio-dashboard.store.spec.ts`).

## Deferred / disclosed

- `data-mode="tracked"` still renders infra shells — #1309 mounts
  `app-gallery-card-chart`; the collapsed `bodyView` switch makes it a
  one-case addition.
- `clearCache`/epoch refresh semantics — session-scoped by spec;
  `clearError` covers the concrete dead-end. Revisit if day-rollover
  staleness matters.
- `'empty'` ("No daily bars") — honest no-data state added beyond the
  spec's literal list (no-blank-frame principle); disclosed.
- Auth-shaped `toolError` would read non-auth — identical to the
  canonical path's classification; accepted parity.
- Case-variant symbol echo → empty bars + `console.warn` — identical to
  `RhChartService.toDataset`; accepted parity.
- jsdom cannot verify overlay positioning/chart paint — Syncfusion
  rendered output is stubbed in specs (FlexChartStub precedent).
