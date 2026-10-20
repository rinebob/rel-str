# Robinhood MCP — Scanner Field Guide (live findings)

> Companion to [rh-mcp-tools-scanners.md](rh-mcp-tools-scanners.md) (the per-tool
> reference). This file captures what we learned running the tools live on
> 2026-10-18 — universe size, caps, unit quirks, and working recipes.
> Everything below was exercised via `preview_scan` (simulation — nothing
> persisted) and read-only tools; no `create_scan` writes were made.

## Running tools locally

```powershell
# from functions/ — requires the IPv4 DNS shim (AT&T IPv6 hang, see AGENTS.md)
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx src/rh-agent-mcp/diagnostics/run-tool-observation.ts <tool> [args.json]
```

- Credential: DPAPI-encrypted file at `%LOCALAPPDATA%\rel-str\rh-agent-mcp\credentials.dpapi` (loaded automatically on Windows).
- Args file: JSON object of tool params. `preview_scan` needs `{filters: [...], columns?: [...]}`.
- `preview_scan` is classified `simulation` — runs unattended; the mutation
  tools (`create_scan`, `update_scan_filters`, `update_scan_config`) prompt/gate.

## Tool surface (8 tools)

| Tool | Class | Role |
|---|---|---|
| `get_scans` | read | list saved scans |
| `run_scan` | read | execute saved scan by `scan_id`, live results |
| `get_scanner_filter_specs` | read | 56 enum filter types + predicates/lengths/intervals |
| `get_scanner_datapoints` | read | expression catalog by `category` (technical, price_volume, fundamental, options, volatility, quote, descriptive, function, field) |
| `preview_scan` | simulation | evaluate a filter set, nothing persisted |
| `create_scan` | write | create scan / append config version (only tool that saves expression filters) |
| `update_scan_filters` | write | REPLACE filter set, enum only |
| `update_scan_config` | write | sort + extra columns |

## Universe, caps, scoping (empirically determined)

- **Coverage is full-market**: `symbol ANY_OF` resolves mega-caps and micro-caps alike (AAPL, MSFT, AAME all found; fake tickers correctly excluded).
- **`total_items` caps at ~400** on this surface: `symbol IN_LIST SP500`, `IN_LIST Russell3000`, and unscoped broad filters all returned exactly 400. UI disclosure says 1,500 — the MCP path caps lower.
- **Result rows cap at 200** (matches the disclosed UI table cap).
- **Futures carry `/` prefix** (`/BTCV26`), crypto appears as BTC/ETH/BNB — both are in the unscoped universe.
- **Scoping is via `symbol`, not an enum filter:**
  - tickers: `{expression: "symbol", predicate: "ANY_OF", values: ["AAPL","MSFT"]}`
  - index: `{expression: "symbol", predicate: "IN_LIST", values: ["SP500"]}` — codes: SP100, SP400, SP500, SP600, DJI, NDX, Russell1000/2000/3000/Midcap/Microcap, sector codes (SOX, XAU, UTY…). No Nasdaq Composite code ("COMP" collides with the crypto).
  - Predicates are not interchangeable: `IN_LIST`+ticker errors; `ANY_OF`+index code silently returns 0 rows. Watchlists/positions can't be scopes.
- `INSTRUMENT_TYPE ANY_OF` looked inert in probes (STOCK→393 vs ETF→398 vs all→394 — all ≈ the 400 cap). Treat as unreliable for narrowing.

## ⚠ Fundamental percentage fields — enum filters unusable

Raw values (columns expose them unscaled):

| Field | Scale | Evidence |
|---|---|---|
| `fundamental.returnOnEquity` | **fraction** (AAPL = 1.49 = 149%) | `>=15` matches ~0; `>0` works |
| `fundamental.netProfitMargin` | **mixed** (AAPL = 0.276; PURR = 45.82) | enum `>=15` catches only percent-scaled junk names |
| `fundamental.marketCap` | raw dollars (5.01e12) | enum `FILTER_TYPE_MARKET_CAP` works fine |
| `eps`, `pegRatio`, `peRatio` | plain numbers | enum/expr both fine |

**Rule: drive PERCENTAGE-grouped fundamentals as expression filters with
fraction thresholds** (`fundamental.returnOnEquity >= 0.15`), never the enum
`FILTER_TYPE_*` percent filters — they pass the literal `15` against raw `1.49`.

- Growth fields (`quarterlyRevenueGrowth`, `annualEpsGrowth`, `quarterlyEarningsGrowth`) appear fraction-scaled too (NVDA revg = 1.06).
- Mixed-scale fields (NPM): a loose floor like `>= 0.10` still catches percent-scaled outliers correctly; tight bands need care.
- Expression boolean form: `{expression: "<expr> >= 0.15", predicate: "=", values: ["True"], display_title: "…"}`.
- Range bounds = two filters AND'd (`mcap >= 10e9` + `mcap < 200e9`); no `&&` needed.

## Column canonicalization gotcha

An expression matching a standard column's canonical form renders under the
standard name, not your `display_name` — `fundamental.marketCap` arrives keyed
`"Market cap"`, `fundamental.returnOnEquity` → `"Return on equity"`. Non-standard
fields keep the given `display_name`. (Bit us once — "blank" columns were just
renamed keys.)

## Working quality screen (verified live, 2026-10-18)

```
symbol        IN_LIST ["SP500"]                     (optional scope)
fundamental.returnOnEquity    >= 0.15   (expr)
fundamental.netProfitMargin   >= 0.10   (expr)
fundamental.eps               >  0      (expr)
fundamental.pegRatio          <= 2      (expr)
```

→ **119 matches** (MSFT, META, MA, V, LLY, GOOGL, GS, CAT, LIN, AMAT…).

### Segmented by market cap (no index scope)

| Segment | Bounds | Matches | Sample |
|---|---|---|---|
| Mega | `mcap >= 200e9` | 30 | ASML, LLY, MSFT, META, TSM, GS, MA |
| Large | `10e9 ≤ mcap < 200e9` | 189 | NVR, FIX, URI, SPOT, STX, AMP, HUBB |
| Mid | `2e9 ≤ mcap < 10e9` | 194 | WTM, NEU, CACC, KNSL, IDCC, KRYS, LGND |

## Presets vs. DIY classics

Presets (create_scan only): `DAILY_GAINERS`, `DAILY_LOSERS`,
`HIGH_OPTIONS_VOLUME_IV`, `UPCOMING_EARNINGS`, `INITIAL`. No highs/lows preset —
build them:

| Screen | Expression |
|---|---|
| At 52-wk high | `tradeAllDay.price >= high(timePeriod="1y", candlePeriod="1d")` → **97 live** (energy-heavy: XOP, XOM, COP, OVV) |
| Top 5% of 52-wk range | `pricePosInRange(candleCount=252, candlePeriod="1d") >= 0.95` → **324 live** (MCK, MA, V, AAPL, RNR, ADP) |
| 52-wk low side | `… <= low(timePeriod="1y", candlePeriod="1d")` or pos `<= 0.05` |
| Gap up/down | `gap(candlePeriod="1d")`, `gapRatio(...)` |
| Volume spike | `dayVolume / volumeAvg(candleCount=30, candlePeriod="1d") >= 2` |
| Above 50d avg | `tradeAllDay.price > closeAvg(candleCount=50, candlePeriod="1d")` (proven in dep-prev-scan-05) |
| IV rank — HIGH | `ivRank >= 0.8` → **175 live** (mcap≥$2B: MTD 100%, URI 99%, MPC 93%, MSI 92%, CBOE 82%) |
| IV rank — LOW | `ivRank <= 0.2` → **201 live** (BLK 0%, TSM 10%, JPM 17%, AVGO 16%) |
| VWAP | `tradeAllDay.price > vwap(candlePeriod="1d")`, `distanceFromVwapRatio` |
| Momentum | `changeIn5DayRatio`, `changeFromPrevDayRatio` |
| Crossovers | `cross(ind1, ind2)` — indicator names as strings; preview to confirm naming |
| S/R levels | `resistance1/2`, `support1/2`, `pivot` |

Prefer `*Ratio` variants for thresholds — raw dollar distances aren't comparable across tickers. `TimePeriod: [1d,1w,1mo,1y]`; `CandlePeriod: [1m..1y]`; `Session: [all, regular]`.

### Volatility / IVR datapoints (category `volatility`)

- `ivRank` — IV position in its own 52-wk range. **Fraction-scaled 0–1 despite "0–100%" doc wording** (verified: `>= 0.8` → 209, `>= 50` → 0; raw values 0.0x–1.0).
- `iv52weeksHigh` / `iv52weeksLow` — 52-wk IV extremes; `iv(daysToExp)` — VIX-method IV for a tenor; `frontIV`/`backIV` — nearest/second expiration IV.
- `atmIv30Day`…`atmIv720Day` + `atmIvXXDayPosInRange` — per-maturity ATM IV and its range position (doc: "fraction 0–1" — same scale as ivRank, so `>= 0.8` form).
- `statVol*` family — realized vol + `statVolXXPosInRange` (HV rank equivalents); `priceStandardDeviation`, `relativeVolatilityIndex`.
- Caveat: IV fields are null for non-optionable names — an IVR floor silently drops them (fine for options screens).
- The `HIGH_OPTIONS_VOLUME_IV` preset is the enum-side approximation; expression `ivRank` gives direct control. Enum `FILTER_TYPE_IMPLIED_VOLATILITY` likely shares the fraction-scale caveat — verify before trusting its thresholds.

## Tracked-symbol evaluation pipeline (built + run)

- Universe source: partner API (`callPartnerTrackedSymbols`, `activeOnly=true`), cached at Firestore `app/trackedSymbolsCache` — **925 symbols** (fresh 2026-10-17).
- Script: `functions/scripts/score-symbols-tmp.ts` (temp) — batches 150/call via `symbol ANY_OF`, pulls 14 fundamental columns, normalizes mixed units, percentile-ranks a composite (ROE 25 / NPM 25 / revG 15 / epsG 10 / FCF>0 10 / leverage 10 / PEG-sane 5).
- Output: `.devin/tmp/symbol-scores.json` (890 scored), `.devin/tmp/prune-report.json`.

### Results

- **Drop candidates ~182**: 35 dead/uncovered tickers (EA, HOLX, FOLD, EXAS, IPG, AKRO… — M&A'd names; dash-class-shares like BRK-B fail even as BRK.B, genuinely absent), 47 all-blank fundamentals, bottom-100 by score (OMER, NVAX, IONS, CYTK — negative ROE/NPM/FCF).
- **Add candidates 254**: quality-screen winners not already tracked (AFRM, BAM, BNY, BHP, AER, AGNC, ARGX…); 159 winners already tracked.
- **Caveat**: fundamentals ≠ tradeability — momentum names (IREN, miners) score badly but may still be good signal sources. "No data" = verify, not auto-delete.

## Misc gotchas

- `create_scan`/`update_scan_filters` are REPLACE semantics — resend the full set.
- Expression filters only persist via `create_scan`; `update_scan_filters` rejects them.
- Cortex-managed scans are read-only.
- No `delete_scan` exists — app-side cleanup only.
- `plot` on enum filters isn't pre-validated (RSI+plot → malformed DXFeed expr; documented bug evidence).
- Predicates accept literal forms (`>`, `>=`, `ANY_OF`, `BETWEEN`, `OUTSIDE`, `=`, `!=`) and wire enums (`PREDICATE_ANY_OF`); `supported_predicates` is per-filter — check `get_scanner_filter_specs`.
- Non-interactive runs: observation/simulation tools fine; mutations need TTY or `RH_PROBE_AUTOYES=1`.
