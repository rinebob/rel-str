# Implementation Plan — FE: RH Scanner page

**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1125  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Domain:** SAVANT-TRADER  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-21  

## 1. Scope

The Scanner page end to end: `previewScan` on the existing MCP client,
the recipe catalog, the compare engine, the scanner store (run + buckets
+ proposals), and the page UI. Route `trading/scanner` under the Trading
nav section.

Conventions: `signalStore` + `withMethods`, OnPush standalone components,
jest specs next to the unit, prior art throughout
`src/app/features/savant-trader/` (gallery-cards.util, analysis.store).

## 2. Data layer

### `RobinhoodMcpClient.previewScan` — `core/robinhood-mcp/robinhood-mcp-client.service.ts`

- `previewScanSpec(recipe: ScanRecipe): ToolSpec<ScanRunResult>` +
  `previewScan(recipe)` convenience — same spec/parse pattern as the
  existing methods. Parse `data.result` → `{ totalItems, rows }`.
- `evaluateUniverseSpec(recipe, symbols[]): ToolSpec<ScanResultRow[]>` —
  `symbol ANY_OF` scope appended to the recipe's filters (replaces any
  baked-in scope); parse keeps rows.
- `evaluateUniverse(recipe, symbols)` — `chunkSymbols` (≤150/call) →
  `executeBatch` over the per-chunk specs; one `/batch` request covers
  the ~925-symbol universe (7 calls, under the 20-call cap and 75s
  budget). Per-chunk rejection isolates to its chunk — the caller
  reports which symbols were never evaluated.

### Scan-row model + value coercion — `utils/scanner-rows.util.ts` (pure)

```ts
export interface ScanRow {
  symbol: string;
  name: string;           // columns['Name'] ?? ''
  instrumentType: string;
  values: Record<string, string>;   // raw stringified column map
  tracked: boolean;                  // stamped by compare, not parse
}
```

- `parseScanRows(result: PreviewScanResult): ScanRow[]` — capture-verified
  shape; missing `ticker` rows dropped.
- `numericColumn(row, displayName, lookup?): number | null` — `Number(v)`
  with `''`/undefined → null (fundamentals are blank-scarce); resolves
  `displayName` through the run's lookup first, falls back to the raw
  name when the mapped key isn't a real column.
- `percentColumn(row, displayName, lookup?): number | null` —
  fraction→percent coercion for the fraction-scaled fields
  (ROE 1.49 → 149.0); the display layer applies `%` formatting, never
  the recipes.
- `canonicalColumnName(lookup, name)` — the backend canonicalizes
  filter-identical expressions to standard column names (observed:
  `ROE` display_name came back as `Return on equity`) — lookups go
  through a `display_name → wire-key` map (recipe static map merged
  under the run's `filters_applied` echo, presence-verified), not raw
  display names.

### Recipe catalog — `features/savant-trader/scanner/scanner-recipes.ts`

~10 recipes, each a `ScanRecipe` (SHARED contracts). Initial set, all
field-guide-verified expressions:

| id | title | core filters |
|---|---|---|
| `quality-mega` | Quality — Mega Cap | ROE≥0.15 ∧ NPM≥0.10 ∧ EPS>0 ∧ PEG≤2 ∧ mcap≥200B |
| `quality-large` | Quality — Large Cap | same ∧ 10B≤mcap<200B |
| `quality-mid` | Quality — Mid Cap | same ∧ 2B≤mcap<10B |
| `high-52w` | At 52-Week High | `tradeAllDay.price >= high(1y,1d)` |
| `near-52w-high` | Near 52-Week High | `pricePosInRange(252,1d) >= 0.95` |
| `low-52w` | At 52-Week Low | `… <= low(1y,1d)` |
| `near-52w-low` | Near 52-Week Low | `pricePosInRange <= 0.05` |
| `ivr-high` | High IV Rank | `ivRank >= 0.8` ∧ mcap≥2B |
| `ivr-low` | Low IV Rank | `ivRank <= 0.2` ∧ mcap≥2B |
| `vol-spike` | Volume Spike | `dayVolume/volumeAvg(30,1d) >= 2` |
| `gainers` / `losers` | Daily Gainers / Losers | % change sort desc/asc |

Percent-valued fields use expression filters with fraction thresholds —
never enum PERCENTAGE filters (fraction-scaled upstream). Columns per
recipe surface the metrics that drive the screen (quality: ROE/NPM/EPS/
PEG/mcap; IVR: ivRank + IV endpoints; highs: price + range position).

### Scanner gateway — `features/savant-trader/services/scanner.service.ts`

Thin wrapper over `RobinhoodMcpClient` + `SymbolListStore.loadTrackedSymbols`
+ proposal persistence:

- `runScan(recipe)` → `previewScan`.
- `evaluateTracked(recipe, symbols, onProgress)` → TWO
  `evaluateUniverse` passes (coverage `{...recipe, filters:[]}` then
  filtered), combined `done/(2·total)` progress; the universe load
  (`loadTrackedSymbols`) lives in the store.
- `saveProposal(proposal)` / `listProposals()` / `getProposal(id)` —
  `st-scanner/proposals/items` via AngularFire (`collection`,
  `addDoc`, `getDoc`/`getDocs` + `query(orderBy('ranAt','desc'))`);
  drift-tolerant reads (list skips, get → null).
- **Tool allowlist:** only `preview_scan` crosses the boundary —
  enforced in the service (and by construction: no other tool has a
  spec here).

### Compare engine — `features/savant-trader/utils/scanner-compare.util.ts` (pure)

```ts
export interface CompareResult {
  rows: ScanRow[];                    // tracked flags stamped
  buckets: CurationProposalBuckets;
  dropDetail: Record<string, Record<string, string>>;
  truncated: boolean;
  unevaluated: string[];              // prune: tracked symbols whose screen
                                      // verdict is unknown (rejected chunk)
}

export function compareDiscovery(
  rows: ScanRow[], tracked: Set<string>, truncated: boolean,
): CompareResult;
export function comparePrune(args: {
  coverage: ScanRow[],       // scope + columns, NO filters — every covered symbol
  matched: ScanRow[],        // scope + filters — passers only
  tracked: string[],
  unevaluated: string[],     // UNION of both evals' rejected chunks
  noDataPred: (row: ScanRow, lookup?: ReadonlyMap<string, string>) => boolean,
  columnLookup?: ReadonlyMap<string, string>,  // the run's merged map —
                                               // display + bucketing share it
  truncated: boolean,
}): CompareResult;
```

- Discovery: `addCandidates = matched ∩ ¬tracked`; `tracked` flag stamped.
- Prune (revised at implementation — live probe 2026-10-20 proved a
  scoped+filtered preview_scan returns only matchers, so one filtered
  eval can't separate "failed" from "uncovered" and can't supply
  dropDetail values; prune therefore runs TWO evals per universe):
  `deadSymbols = tracked ∧ ¬returned ∧ ¬unevaluated` where
  `returned = covered ∪ matched` (verify-before-drop per CONTEXT.md);
  `noData = tracked ∧ row ∧ noDataPred(row, columnLookup)` — checked
  before the matched-pass so a passer with blank key metrics still
  flags, and the predicate resolves through the run's merged lookup
  so bucketing and display can't split under canonicalization drift;
  `dropCandidates = covered ∧ tracked ∧ ¬noData ∧ ¬matched ∧
  ¬unevaluated` — a covered symbol in the union can only mean its
  matched chunk rejected (a rejected coverage chunk yields no row),
  so its screen verdict is unknown, not "failed"; dropDetail = the
  coverage row's column values. The surfaced `unevaluated` list =
  tracked symbols whose screen verdict is unknown (unscreened via a
  rejected chunk on either side), folded into no bucket.
- `truncated`: caller derives via shared `isScanTruncated(result)` from
  `@st/scanner` (`results.length >= 200 || total_items > results.length`)
  and passes the flag in — single canonical rule, don't re-derive.

### Store — `stores/scanner.store.ts`

`signalStore` state: `recipes`, `activeRecipeId` (+computed
`activeRecipe`), `running`, `rows`, `compare` (CompareResult | null),
`proposals` (+`proposalsLoading`), `error`, `evaluating` (progress:
done/total — one tick per /batch group), `proposalOpen`; computed
`busy`, `requiresReauth`, `canEvaluateTracked`. Superseded-run
cancellation via `runSeq`/`scanSeq`/`evalSeq` tokens — a newer run
drops a stale result/error/save-prepend; `selectRecipe` supersedes
too. Persist failure surfaces as `proposal save failed — …` with the
compare kept (not a run failure).

Methods: `selectRecipe`, `runScan` (→ discovery compare + persist),
`evaluateTracked` (prune direction, quality recipes only — enabled when
the recipe declares `supportsPrune`; runs evaluateUniverse TWICE —
coverage eval with scope+columns and no filters, then the filtered eval
— and unions both `unevaluated` lists), `loadProposals`, `openProposal`,
`closeProposal`, `clearError`.
Proposal persisted on every completed compare (both directions) —
auto-persist, not a save button.

## 3. Page — `pages/scanner/scanner.component.ts` + children

```
┌─ header: recipe picker (select w/ blurb) · Run · Evaluate tracked ─┐  #1140
│  status line: "143 shown of 400 matched" (eval: "N rows · M        │  #1140
│    matched") | spinner · truncation warning                        │
├─ results table: symbol · name · tracked-badge · recipe columns ────┤  #1140
├─ compare panel: Add (n) | Drop (n) | Dead (n) | No-data (n) ───────┤  #1141
│    bucket expandos → symbol chips → row focus                      │
├─ proposal history: ranAt · recipe · bucket counts → open ──────────┘  #1141
```

Task split (#1140 shipped picker/status/table + error/reauth/empty
states; #1141 lands the compare panel + proposal history):

- Route: `AppRoutes.SCANNER = 'trading/scanner'`; nav under Trading
  (`Gallery · Live · Paper · Analysis · Scanner` — appended last; this
  sketch predated Analysis landing); `PAGE_INFO` title `Scanner`,
  icon `radar` (or nearest material icon).
- Tracked badge styling reuses the badge vocabulary (`.badge`); drop
  rows can carry `.dir-edge-*`-style accents.
- Error states: `RobinhoodMcpError` category `AUTH` →
  "Robinhood session expired — re-authorize in the popup window, then
  retry the scan" banner with a working **Re-authorize** button
  (`RobinhoodMcpObservationService.reauthenticate()`, the signal-order
  flow — as-built #1140; the button supersedes the sketch's static
  runbook hint. No SESSION category exists); other errors → inline
  error banner with dismiss.
- Status line always shows the count pair and warns at caps —
  as-built: `N shown of M matched` for discovery, `N rows ·
  M matched` for prune (store's `runKind`; prune display rows are
  coverage∪matched — rows that returned data, not the evaluated
  universe — so neither "shown of" nor "evaluated" is honest).
  `matchedCount` is wire `totalItems` (discovery, truthful past the
  cap) / unique matched symbols (prune — case-deduped so M can't
  exceed the row count). Truncation fires on the cap page AND the
  partial-page case (`total_items > rows < cap`) — the warning
  covers both without claiming which.
- Progress during `evaluateTracked`: `Evaluating tracked symbols…
  done/total chunks` — the store ticks once per settled /batch group
  (#1139 review), so the label stays coarse rather than implying
  per-symbol granularity.
- Column resolution: the store presence-verifies [response echo,
  static `columnLookup`, raw name] per run into a `columnLookup`
  state map (mergeLookup) — the page's cells/sort AND `noDataPred`
  share it, so display and bucketing can't split under
  canonicalization drift. `percentColumns` marks fraction-scaled
  columns for `N.N%` rendering; the table re-sorts the wire's
  Last-desc page per `recipe.sort` client-side.
- Compare panel (#1141 as-built): ONE dumb
  `ScannerComparePanelComponent` renders both the live compare
  (`CompareResult.buckets/unevaluated/dropDetail` → `ComparePanelData`)
  and a reopened proposal (`CurationProposal` → same shape —
  `unevaluated` absent per contract; `readOnly`/`title`/`meta` inputs
  drive the saved-proposal header + close). Non-empty buckets render
  as expandos with count badges; chips emit `focusSymbol` and the page
  highlights + scrolls the matching `tr[data-symbol]` (no-op when the
  symbol isn't in the table — e.g. a reopened proposal's symbols).
  `dropDetail` surfaces as the chip tooltip (key: value pairs, `—`
  for blanks). Proposal history loads on init, lists
  `ranAt · recipe · per-bucket counts`, and `openProposal` renders the
  detail panel above the list — the store clears `proposalOpen` at the
  START of a new run; a proposal opened mid-run can co-render with the
  landing compare (still valid read-only data; expando ids are
  per-instance so aria-controls can't collide).

## 4. File sketch

```
src/app/features/savant-trader/
├── pages/scanner/
│   ├── scanner.component.{ts,html,scss,spec.ts}                  (#1140)
│   └── scanner-compare-panel.component.{ts,html,scss,spec.ts}    (#1141)
├── services/scanner.service.{ts,spec.ts}
├── stores/scanner.store.{ts,spec.ts}
├── scanner/scanner-recipes.ts               (+ catalog spec)
└── utils/
    ├── scanner-rows.util.{ts,spec.ts}
    └── scanner-compare.util.{ts,spec.ts}
src/app/core/robinhood-mcp/robinhood-mcp-client.service.ts   (EDIT)
src/app/core/common/{interfaces.ts,constants.ts}             (route/nav)
functions/scripts/verify/rh-scanner-recipes-1098.ts          (NEW relay)
```

## 5. Verify relay — `functions/scripts/verify/rh-scanner-recipes-1098.ts`

Dry-run: every catalog recipe through `preview_scan` on the real session
via the existing executor path — asserts each returns `success` +
`results[]` shaped per contract (schema-drift tripwire, read-only).
As-built (#1141): imports `SCANNER_RECIPES` directly (the relay asserts
the catalog the page ships, not a copy); catalog-level check pins unique
ids + non-empty filters; per-recipe `preview_scan(filters, columns)` —
the production arg shape — then asserts `total_items >= results.length`
and the row contract (ticker/instrument_id/instrument_type + string
columns). A requested column key (or its `columnLookup` rename) absent
from EVERY row is a WARN, not a fail — sparse columns aren't drift.
A failed recipe logs FAIL and the loop continues — every recipe is
exercised; `toolError` surfaces before the data.result assert.
Build side-effect: `scripts/verify/*.ts` sits in the functions tsconfig
include, so `npm run build` compiles the relay AND its `src/app`
imports (`scanner-recipes`/`scanner-rows.util`, both Angular-free)
into `functions/lib/src/app/...` — extra bytes in the deploy bundle,
consistent with every script already there.
Registered in `scripts/verify/run-all.ts` + README row; needs the same
credential/env setup as `run-tool-observation.ts`.

## 6. Risks / notes

- **Cap:** broad recipes truncate at ~400/200 — the page always shows
  `shown/matched` + a truncation warning; scoped variants bound it.
- **Latency:** a single preview is seconds; `evaluateTracked` is one
  batch (~7 calls) — tens of seconds worst case, progress shown.
- **Stale session:** surfaced as a first-class error state, never a
  silent empty table.
- **Canonical column names:** filter-identical expressions may come back
  under standard names — recipes declare `columnLookup`, never rely on
  `display_name` echo.
- **No `run_scan`/`get_scans`/mutations** — allowlist enforced in the
  service; a stray tool name fails client-side before any request.
