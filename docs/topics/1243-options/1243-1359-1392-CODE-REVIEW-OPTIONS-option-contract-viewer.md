**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** options  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1359  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1392  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-09  
**Last Updated:** 2026-11-09  

## Verdict

**PASS — two passes.** Three review axes on the scoped diff + all eight
new files; zero critical, zero major. Pass 1 remediated the cheap
in-gate minors (real page-scoping pin, `Provider[]` typing, stale
comments, redundant `take(1)`). Pass 2 (user-requested re-review)
verified the remediation delta, closed the last two unpinned behavioral
semantics (`loadConfirmOpen` drop-while-pending, `bindRuns` error
branch — now 2 new specs), and re-checked every deferred call —
nothing else gating surfaced; no third pass warranted. Focused suites
71 green; full suite 304/5,354 green pre-remediation; `tsc --noEmit`
clean; AOT `npm run build` clean.

## Scope

Uncommitted working-tree change for #1392 — `option-chart.component.ts`
split from 1,108 lines to 362 (a composition root: view projections +
lifecycle + a verbatim-mirror facade) plus six page-scoped injectables
and one providers file:

| File | Lines | Owns |
|---|---|---|
| `option-chart-page.service.ts` | 87 | shared context: symbol, occIdInput, listError, chartExtents hook, initSession/onSymbolChange |
| `option-chart-catalog.service.ts` | 532 | builder fields, sort, display/query filters, menus, filter-to-chart, pagination, nav |
| `option-chart-list.service.ts` | 187 | `?list=` deep link, chooser→doc tail, picker dialog, emitSessionLines |
| `option-chart-load.service.ts` | 104 | onLoad parse→confirm→loadPlotted, emitLinesToChart, rejects |
| `option-chart-replay.service.ts` | 82 | runs dropdown + pick→slice→load |
| `option-chart-generator.service.ts` | 41 | drawer, brush→alive-range, generator send |
| `option-chart-page.providers.ts` | 31 | `OPTION_CHART_PAGE_PROVIDERS` — component + specs share one list |

Also scoped: the three spec files' provider-array swap
(`OPTION_CHART_PAGE_PROVIDERS` spread), the new
`option-chart-services.spec.ts`, and the IMPL doc's
"Page-wiring extraction" section. All other dirty files in the tree
(portfolio #1414, scanner, trigger-bands, backtest, sandbox, #1430
`option-chart-list.spec.ts` hunks) are foreign sessions — excluded.

## Standards axis

Clean split; dependency graph is a genuine one-way DAG (units → page
context, units → load; `providers.ts` sits above and is imported by
nothing the services need — no cycle). DI verified: `inject(Injector)`/
`DestroyRef`/`ActivatedRoute` in component-provided services resolve the
page's node context, so the picker dialog gets the same page-scoped
`ContractListSessionStore` (same mechanism the old component used).
`OPTION_CHART_PAGE_PROVIDERS` is a single source of truth shared by
`component.providers` and TestBed spreads — membership cannot drift.
Bare `@Injectable()`s (no `providedIn`) fail loudly (NG0201) outside the
page context, never silently wrong-bind.

## Spec axis — all six ACs MET

1. **Component <1,000 (~600 target)** — 362 lines. MET.
2. **Page-scoped session store shared with picker** — store registered
   in `OPTION_CHART_PAGE_PROVIDERS` on `component.providers`, not
   root-provided; service captures `inject(Injector)` and passes it to
   `dialog.open` (`option-chart-list.service.ts:40,182`); picker's
   required `ContractListSessionStore` inject resolves the page instance.
   Strengthened pin in `option-chart-services.spec.ts` — a doc applied
   through the service lands on the same store TestBed resolves. MET.
3. **`?list=` unchanged** — `bindDeepLink` preserves the exact chain:
   `queryParamMap → get('list') → distinctUntilChanged →
   takeUntilDestroyed → navigate {list:null, merge, replaceUrl}` →
   consume-once; whitespace consumed without load; validate-before-
   switch; named errors render outside the drawer. MET.
4. **Single `getList$` read** — chooser row goes straight to
   `onContractListDoc` → `loadListDoc` (no refetch); `list.spec.ts`
   pins `times(1)` + chooser never calls `getList$`. MET.
5. **Specs green + seam specs** — 69 option-chart green (62 preserved +
   7 new); new spec pins symbol-switch orchestration, initSession
   seeding, builtOccId, chartExtents both branches, rejectionReasonLabel,
   clearStudyRange, and the strengthened page-scoping pin. MET.
6. **tsc clean** — `tsc -p tsconfig.app.json --noEmit` exit 0; AOT build
   also clean (validates all ~60 template-bound delegates, which tsc
   alone does not). MET.

Behavior-equivalence audit (moved-code comparison vs HEAD): every
ordering guard and contract comment is verbatim — `listDocReqSeq`
supersession, consume-then-navigate order, `sentLines` deferred write
through the >50 confirm, `loadConfirmOpen` drop, picker no-stack +
afterClosed null-out, `onSymbolChange` seven-step ordering, replay
bail-before-switch ordering, NG0914 emit-callback rationale. The stale
`watchContractLists` mock name in two pre-existing specs was corrected
to `watchContractList` (it was a dead mock — bonus fix).

## Findings

### Remediated in-gate

- **Minor — weak page-scoping pin** (`option-chart-services.spec.ts`).
  Original test asserted `instanceof` + `status==='idle'` — DI trivia.
  Replaced with a real instance-identity pin: drive
  `list.onContractListDoc(doc)` and assert `loadListDoc` spy fired on
  the TestBed-resolved store + `activeList().listId` landed. Caught a
  real fixture precondition in doing so (session symbol must be set
  first, as `initSession` does — `setSymbol('QQQ')` added).
- **Minor — untyped providers const** (`option-chart-page.providers.ts`).
  Now `Provider[]`.
- **Nit — cryptic comment** (`option-chart-generator.service.ts`).
  Reworded to describe the (studyRange) wiring accurately.
- **Nit — redundant `take(1)`** (`option-chart-replay.service.ts`).
  `firstValueFrom` already completes on first emission.
- **Minor — `loadConfirmOpen` drop-while-pending unpinned** (pass 2).
  The flag's only semantic — a send during a pending >50 confirm must
  drop, not stack a second dialog or queue a load — was unpinned
  pre-move and post-move. New spec drives a pending `afterClosed` and
  asserts one dialog + one deferred `loadPlotted(51 entries)`.
- **Nit — `bindRuns` error branch unpinned** (pass 2). A dead
  `watchRuns` stream now has a spec asserting the named
  `replayError` instead of silent failure.
- **Nit — IMPL doc staleness** (pass 2). Said "358 lines"; the pass-1
  header-comment addition made it 362 — corrected.
- **Minor — dead facade aliases** (~16 members, e.g. `builtOccId`,
  builder dropdown signals, `onContractListDoc`). Dead pre-refactor too
  (builder section slimmed earlier), preserved deliberately by the
  verbatim-mirror policy. Kept — the component header comment now says
  so explicitly, since the layout rework (#1423) may rebind them.

### Deferred recommendations (non-blocking)

- `option-chart-catalog.service.ts` carries ~50 lines of duplicated
  Set-toggle/clear bodies (`toggleQueryLengthBucket`/`toggleExpiration`/
  `toggleLengthBucket`, the two `*Group` variants, three `clear*`).
  A `toggleInSet`/`toggleGroupInSet` helper pair collapses them —
  deferred: the AC asked for extraction, not refactoring moved code.
- `compareByField`/`SortField`/`SortLevel` are pure — a
  `catalog-sort.util.ts` would make sorting DI-free unit-testable and
  shave the service. Same defer rationale.
- `page.chartExtents` is a mutable function slot — works, spec-pinned
  both ways, but `bindChartExtents(fn)` or a component-side extents
  argument would be more idiomatic. Accepted as-is.
- `option-chart-page.service` name is honest-but-vague
  (`option-chart-context.service` would be more precise). Rename is
  cheap now, churning later — deferred to whenever the file next opens.
- `OptionChartReplayService` has no direct unit spec in the new file —
  covered via `option-chart.component.spec.ts:510-600`. Coverage
  adequate; flag only.
- TestBed-vs-component `DestroyRef` divergence: in specs,
  `bindDeepLink`'s `takeUntilDestroyed` binds TestBed's DestroyRef, not
  the component's — invisible, no current test trips it. Prod behavior
  is correct.

## Test results

- `npx jest src/app/features/savant-trader/pages/option-chart` —
  4 suites / **71 tests green** (62 pre-existing + 9 seam specs)
- `npx jest` full suite — **304 suites / 5,354 tests green**
  (pre-remediation run; remediation touched one spec + three
  comment/type-only lines + a redundant operator, re-verified focused)
- `npx tsc -p tsconfig.app.json --noEmit` — clean
- `npm run build` (AOT) — clean; only the pre-existing `papaparse`
  CommonJS warning
- Mechanical member census (pre-refactor component vs new structure):
  zero missing members; template identifier audit: all bare identifiers
  resolve via `store.`/`listStore.`/`genStore.`/`$event.` or delegates

## Verdict

**PASS.** The extraction is a faithful move — every AC is met with
evidence, the moved code is verbatim modulo rewires, DI scoping is
correct in both prod and TestBed, and the new seams are spec-pinned.
Deferred items are pre-existing surfaces or optional polish, none
gating. Task advances to `7_QA`.
