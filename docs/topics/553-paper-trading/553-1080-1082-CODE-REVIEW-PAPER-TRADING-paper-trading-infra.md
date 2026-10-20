# CODE-REVIEW — #1082 FE analysis route + dataset library + run-config form

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1082  
**Blueprint:** #1080  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1082  
**Domain:** PAPER-TRADING  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-19  
**Last Updated:** 2026-10-19  

## Verdict: PASS (four findings fixed across two passes)

## Second pass (per user request — re-sweep until no new findings)

4. **Invented CSS custom props** — scss used `--border-color`,
   `--surface-2`, `--warn-color` with hardcoded fallbacks; the
   codebase standardizes on `--mat-sys-*` tokens (#1024 DS work).
   Replaced with `outline-variant` / `surface-container` / `error`.

Checked clean on pass 2 — `[class]` binding merging with the static
`status-chip` class (spec-verified); `getRawValue` including disabled
controls (live branch ignores them regardless); the generate chain not
clobbering `datasetsSub` (last-write-wins on identical data); buttons
inside `mat-card-actions` not needing `type="button"` (outside the
form); `form.reset` re-firing origin `valueChanges` to re-enable replay
controls; poll interval gating + destroy cleanup.

## Scope

Working-tree diff covering only the #1082 files (the tree also holds
the uncommitted #1081 service/store plus unrelated #762/#1024/#1098
work — excluded):

- `src/app/core/common/interfaces.ts` — `AppRoutes.TRADE_ANALYSIS`
- `src/app/core/common/constants.ts` — `PAGE_INFO`, Trading nav item,
  `CallableName.GENERATE_TRADE_DATASET`
- `src/app/core/core-routes.ts` / `core-routes.spec.ts` — auth-gated
  lazy route `trading/analysis` beside `trading/paper`
- `src/app/core/common/nav-sections.spec.ts` — Trading section parity
- `src/app/features/savant-trader/utils/analysis-run-config.util.ts`
  (+ spec) — pure validation/parse/search helpers
- `src/app/features/savant-trader/services/analysis.service.ts` —
  `generateDataset$` callable wrapper (+ spec)
- `src/app/features/savant-trader/stores/analysis.store.ts` —
  `generateDataset` method + `isGenerating` (+ spec)
- `src/app/features/savant-trader/pages/analysis/` — page + run-config
  components (8 files, all new)
- `src/app/features/savant-trader/pages/paper-trading/` — header
  'Trade Analysis' link (+ spec pin)
- FE IMPL doc §2 as-builts

`gallery-ticket-dialog.component.ts` (UpperCasePipe removal) is a
user-requested stray fix landing with their in-flight #762 work —
excluded from this scope.

## Findings fixed during review

1. **`barRange` group validator read disabled controls** — a stale
   inverted date range set in replay mode would still flag
   `form.invalid` after switching to live, silently blocking every
   live submit. Validator now returns null when either control is
   disabled; spec-pinned.
2. **`nav-sections.spec.ts` not updated** — the Trading section
   assertion (`['Gallery','Live','Paper']`) broke when 'Analysis' was
   added; spec now expects the four-item order and the href-parity
   list carries `trading/analysis`.
3. **Convention drift** — `@Output() EventEmitter` → `output()` (the
   codebase's newer-component API); unused `MatTooltipModule` removed;
   stray `*ngFor` converted to `@for`.

## Held clean (checked, no change)

- `LIVE_DEFAULTS.barRange.to = ''` placeholder — filled with
  `toIsoDate(new Date())` at submit; documented in the util. The empty
  string never reaches the wire (submit builds a fresh barRange).
- `generateDataset` meta-write `catchError(() => of(void 0))` —
  deliberate: the callable already minted the doc; a tags/notes write
  failure must not skip the library refresh that surfaces it.
- 5 s `setInterval` poll — zone-triggered CD every 5 s is cheap; the
  timer is cleared on destroy and skips when no `generating` entries
  or a load is in flight.
- Card-action spec selectors are positional (button order in
  `mat-card-actions`) — brittle-by-design trade-off accepted; they're
  pinned to the template's action order which is stable.
- "Max hold days" from IMPL §2 intentionally dropped — no such field
  on `AnalysisRunParams`; time exits live in the registry grammar
  (`time-{N}d`). Recorded as an as-built deviation.

## Verification

- Targeted: **all #1082 specs green** (14 page + 10 form + 4 store +
  1 service + 16 util + route/nav/paper-link specs)
- `tsc -p tsconfig.app.json` — clean
- `ng build` — clean (AOT compiles the lazy chunk)
- Full suite: **4,017/4,019** — the two failures are pre-existing
  concurrent-work drift, unchanged since the #1081 review:
  `screenshot-capture-contracts.spec` (PositionType expanded) and
  `sidenav-menu.component.spec` (DS Gallery dev item). Neither file is
  in this diff.

## AC traceability

| AC | Evidence |
|---|---|
| Provenance at a glance + searchable by symbol/name/tag | card grid renders origin badge/status/params/scope/rowCount/generatedAt; `matchesDatasetSearch` spec'd over id/origin/rule/symbols/types/tags/notes |
| `generating` renders pending + refreshes to ready | spinner chip + Open disabled; 5 s `loadDatasets` poll while generating present (fake-timer spec) |
| Invalid input blocks submission before the callable | `submit()` swallows `form.invalid` + `markAllAsTouched`; specs for bad exit grammar, inverted range, disabled-control staleness |
| `generateTradeDataset` → `{datasetId}` | service wraps `httpsCallable`; store chains callable → optional meta → `listDatasets$` refresh |
