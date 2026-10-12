**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Extend Gallery UI to Portfolio Page  
**Thread Slug:** portfolio-gallery-view  
**Issue:** #949  
**Thread Parent:** #926  
**Topic Parent:** #219  
**Task:** #952  
**Domain:** PORTFOLIO  
**Type:** CODE REVIEW  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-12  

# Code Review — position card chart (#952)

Three-axis gate review of task #952's change set: the new
`components/position-card-chart/` component (`.ts`/`.html`/`.scss`/spec)
cloned-and-adapted from `gallery-card-chart`, and the
`position-card.component` wiring (defer mount + import). Reviewed
against IMPL §5/§8 and the TEST doc's `position-card-chart` section.

All findings below were **fixed in this session** and re-verified before
the verdict; severities are as filed by the reviewing axes.

## Standards

### Findings (remediated)

- **Hard → resolved — `POSITION_CHART_CONFIG_NAME` read as dead code**
  (guidelines §3). The export was consumed only by a tautological spec
  (`expect(const).toBe('literal')` — a TDD anti-pattern). Resolved two
  ways: the tautology was replaced by a real contract test (below), and
  the const itself is the IMPL-mandated `'Position Chart'` placeholder —
  no chart-config registry exists yet to register it into, so the
  exported name + comment **is** the reservation the spec asks for.
  Kept, documented.
- **Minor — spec mock gap: `version` never set.** `versionFor()`
  returned `''`, `indicatorResponse` short-circuited, and the
  `() => () => undefined` `responseFor` mock could hide signature drift.
  Fixed: `version` defaults to `'v1'`, the mock mirrors the real
  selector-factory shape (outer call takes no args; the returned
  selector takes the five), and a spec asserts
  `responseForSelector('AAPL','v1',DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_INDICATORS,DEFAULT_CHART_STRATEGIES)`.
- **Minor — `linkedSignal` source typed `SignalTimeframe`** where the
  store's `CardChartTimeframe` is narrower (copy residue). Fixed.
- **Nit — `mounted` pass-through `computed`.** Fixed:
  `granted.asReadonly()`.
- **Nit — stale `#926/#951` header tag on position-card.** Now carries
  the `#952` chart-cell ref.

### Judgement calls (documented, not blocking)

- **Duplicated Code (~250/321 lines mirror the gallery component)** —
  deliberate per IMPL ("cloned-and-adapted"; the two are expected to
  diverge). Both axes recommended a sync note over premature extraction;
  reciprocal `KEPT IN SYNC WITH` headers now mark the shared machinery
  (interval lane, leaf selectors, extras, config scaffold, grant
  protocol) on both files. Extraction to a shared
  `buildCardChartLane`/mount helper remains the right move if a third
  card-chart consumer appears — deferred to that consumer, not now.
- **`as unknown as` IO stub casts in the spec** — jsdom IntersectionObserver
  has no firing path; justified, consistent with the reference spec.
- **8 deep cross-feature imports into `savant-trader/` internals** —
  consistent with existing sharing on this page (facade already consumes
  `GalleryCardChartStore`); flags `savant-trader` as a de facto shared
  package, worth a boundary decision in a later thread, not this task.

## Spec

### Findings (remediated)

- **Doc mischaracterization — "error block with retry."** IMPL §8/TEST
  describe an "existing gallery behavior" retry that does not exist —
  the gallery's error lane is a static `chart unavailable` block.
  Implementation matched reality, not the letter; IMPL/TEST corrected
  (error block, no retry; manual refresh re-ensures via the epoch
  effect).
- **Doc ambiguity — "no signal dots."** Literal reading collides with
  the kept callable `signalDots`/uptick extras; correct reading is *no
  per-card occurrence dots* — the extras are symbol-level indicator data,
  the same default ST set quick-charts renders. IMPL/TEST wording
  corrected; spec pins both halves (no `st-card-signal-dots` id, no
  overlay-pane `st-signal-dots` type).
- **`'Position Chart'` registration** — the exported const is the
  placeholder/enum entry the IMPL prescribes; no vocabulary registry
  exists to hold it yet. Kept (spec-required, not speculative).
- **Mount-once latch vs. cloned viewport-unmount** — accepted QA
  refinement (scroll remounts flashed and reflowed the page); recorded
  as divergence in IMPL §5/§8 and the TEST doc.

### Verified met

`GalleryCardChartStore` + `IndicatorSeriesStore` + mount-queue
consumption; per-card D/W + same-value seq resync against the real
`PortfolioGalleryUiStore`; `@defer (on viewport; prefetch on idle)`;
page prefetch wired (#950); interval-scoped error lanes; epoch re-ensure
on cache clear; `symbol`-only input boundary; ±50 visible-bar chips;
`st-card-signal-dots` absent.

## Thermo-nuclear

### Findings (remediated)

- **Latch correctness verified** — no path leaves `mounted` true on
  stale data; destroy disconnects the observer and `grantTicket++`
  invalidates queued grants. Two honest-test additions pinned the new
  semantics: queued grant survives scroll-out; queued grant no-ops after
  destroy.
- **Minor — overstated observer comment** (the 600px margin
  "pre-mounts" — unreachable; the card's `@defer` already gates creation
  at viewport entry). Comment corrected: the observer is a
  has-ever-intersected + re-entry signal.
- **Minor — memory bound undocumented.** Comment now states the assumed
  bound (live position count — realistically tens; the signal gallery's
  unbounded scroll is what forced viewport-unmount there).

### Deferred (documented, next tasks own them)

- **Shared card-chart machinery extraction** — the ~90 entity-agnostic
  lines (leaf selectors + extras + config scaffold) encode the #819/
  #838/#860 fixes; the concrete failure mode is a gallery-side mount
  fix not propagating. Mitigated now by the reciprocal sync headers;
  extract when a third consumer exists.
- **Clone vs. parameterize** — clone confirmed correct: a parameterized
  gallery component would carry 4+ behavioral branches in its most
  subtle code (entity input, UI store, scroll root, mount semantics).
- **Eager card mount in collapsed groups** (carried from #951) —
  dormant while `useExpandos` is false; if expandos return,
  `matExpansionPanelContent` lazy rendering is the seam.

## Test results

- Focused: **510 specs green / 31 suites** — the full
  `portfolio-dashboard` set including the new 32-spec chart suite
  (daily/weekly lanes, D/W + seq resync, ±50 chips, cross-symbol patch
  identity, mount-once latch, mount-queue pacing, IO root on `.pg-body`,
  entity-boundary negatives, `responseFor` contract).
- `tsc --noEmit`: clean on the change set; the repo reports 3
  pre-existing errors in unrelated WIP files (`bulk-swing-sweep.ts`,
  `indicator-config-dialog.component.ts`).
- Full suite: 2 failing suites, 43 tests — `screenshot-capture-contracts`
  (`PositionType` enum grew option values) and `order.component`
  (missing `Functions` provider for the new `ScreenshotService`). All
  traced to unrelated uncommitted screenshot/options WIP — identical
  pre-existing class as the #951 round, none in the change set.

## Verdict: PASS

One hard-flagged item (dead-const reservation) resolved as
spec-required-and-re-tested; a cluster of real minors — mock-contract
gap, widened type, pass-through computed, doc drift — all remediated
before this verdict. The clone discipline held: every divergence from
the gallery reference is deliberate and documented (mount-once latch,
`symbol`-only entity boundary, `.pg-body` scroll root, no occurrence
dots).
