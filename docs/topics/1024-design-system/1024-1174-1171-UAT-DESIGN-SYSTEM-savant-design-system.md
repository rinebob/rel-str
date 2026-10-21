# UAT — #1171 foundation-mixin consumer migration

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1174  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Task:** #1171  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

## Scope

Task #1171 adopted the graduated foundation mixins (`error-banner`,
`state-block`, `stat-strip`, `dense-table`) across the remaining hand-rolled
surfaces and deduplicated the local `spin` keyframes. Nothing user-facing is
*new* — acceptance is that every migrated surface renders with the
standardized DS presentation (tokenized colors, canonical markup
conventions) and no regression in layout, density, or behavior.

QA issue: #1174. Review (PASS, 2 rounds):
`1024-1109-1171-CODE-REVIEW-DESIGN-SYSTEM-savant-design-system.md`.

## Prerequisites

- Repo: `C:\aa\projects\rel-str`, working tree carrying the #1171 diff.
- `npm install` already done; `vendor/savant-ds` present.
- Auth: a signed-in session (all app routes sit behind `authGuard`). Use the
  normal local dev login.
- No seed data needed for the empty-state scenarios — they require *no*
  data, which makes them easy to reach.

## Start

```bash
npm start          # ng serve → http://localhost:4200
```

Sign in, then navigate per scenario.

## Scenarios

### S1 — Migration relay (automated)

- Command: `npx tsx scripts/verify/design-system-foundation-migration-1171.ts`
- Expected: `110/110 checks passed`.
- Evidence: relay output.

### S2 — Sibling relays regression (automated)

- Command: `npx tsx scripts/verify/design-system-widget-migration-1114.ts` and
  `...-widget-migration-1115.ts`
- Expected: `47/47` and `30/30`.
- Evidence: relay outputs.

### S3 — Dev build (automated)

- Command: `npx ng build --configuration development`
- Expected: `Application bundle generation complete`, no SCSS errors.
- Evidence: build output.

### S4 — Spec suite (automated)

- Command: `npx jest --coverage=false`
- Expected: all suites green.
- Evidence: Jest summary.

### S5 — Error banners (`trading/paper`, `options/strategy/build`, `options/strategy-dashboard`)

All three banners render when the page's store has `error != null`; each
store sets it from a failed Firestore-backed load. To induce it:

This scenario verifies a *style*, not an error path — the banner's CSS is
the identical mixin already shipping on portfolio-dashboard banners, and
the R2-2 `MatIconModule` risk is covered by the spec re-run. Two ways to
see it; pick one:

**Method A — DOM paste (recommended, ~30s):**

1. On the target page, F12 → **Elements** — find any element inside the
   page component and copy its `_ngcontent-ng-cNNN` attribute (Angular
   style-scoping; pasted nodes without it get no component CSS).
2. Right-click a container element → **Edit as HTML** → append:
   ```html
   <div _ngcontent-ng-cNNN class="error-banner" role="alert"><span class="error-text">Failed to load paper trades</span></div>
   ```
   substituting the copied attr.
3. For the icon: copy the `outerHTML` of any real `<mat-icon>` on the page
   and change its text to `error`.
4. Expected: tinted `--mat-sys-error-container` bg, `on-error-container`
   text, subtle border, rounded corners, leading icon glyph.

**Method B — live error (optional; verifies the wiring too):**

- DevTools → **⋮** → **More tools** → **Request conditions** (older
  Chrome: **Request blocking**) → enable, add pattern
  `firestore.googleapis.com` → reload → the store's `catchError` patches
  `error` → banner. Remove the pattern afterward (it blocks Firestore
  app-wide). A coarse fallback is the Network tab's **Offline** checkbox.

**Method C — skip (defensible):** mark S5 PASS-by-compilation — the mixin
output is verified in the relay's compiled-CSS checks and the markup is
identical to shipped PD banners; only spot-check if a later scenario
surfaces a banner naturally.

### S6 — Order page scoreboard + queue (`trading/live`)

- Expected: the scoreboard strip renders label/value pairs with pipe (`|`)
  separators — labels dim (`on-surface-variant`), values bold monospace
  (`--ds-on-surface`); negative values red.
- Below: `app-order-queue` — with no staged orders the empty state shows
  the `inbox` icon (36px, dim), "No staged orders" copy, and hint text as a
  centered column block.
- Evidence: screenshot/DOM inspection of `.scoreboard .sb-*` and
  `.empty-state`.

### S7 — Allocation bucket stat strips (`portfolio` / `portfolio/allocation`)

- Open the allocation buckets table; expand a bucket row — `.expand-stats`
  shows canonical `sb-item`/`sb-label`/`sb-value` pairs; **Drift renders red
  when negative** (specificity fix — `.sb-value.neg` must beat the mixin's
  value color).
- Open a bucket's detail dialog — `.stats-strip` and `.pos-stats` strips
  with pipe separators; Drift/Unrealized red when negative.
- Evidence: computed color on a negative `.sb-value.neg` is `var(--ds-down)`.

### S8 — Dense tables (`trading/paper`, `options/strategy/build`, `options/strategy-dashboard`)

- `.trades-table`: header row stays pinned while scrolling the
  `.table-scroll` container (sticky under `border-collapse: separate` +
  th-level sticky); sortable headers show hover affordance; header text
  renders **UPPERCASE** at `--ds-font-size-2xs` (new canonical look).
- `.instances-table`: rows hold the 24px dense height; lifecycle badges
  (`active`/`paused`/`stopped`) show success/warning/error container
  tinting — no raw hex.
- `.positions-table`: same uppercase-header convention; hover row
  highlighting.
- Evidence: visual + computed style on `thead th` (`text-transform:
  uppercase`).

### S9 — Empty / no-data states (remaining surfaces)

| Surface | Route / host | What to check |
|---|---|---|
| chart-review | `signals/charts` | `.empty-state` icon+copy+hint centered column |
| signal-review | `signals/review` | `.empty-state` / `.error-state` blocks |
| backtest run list / summary / perm detail | `options/strategy/backtest` | empty-state blocks render canonical (36px icon, copy, hint) |
| run-history-panel + run-metrics-strip | `signals/runs` dashboard | empty block; **running indicator still spins** (global `spin` keyframes — confirm the `mat-icon.sync` animates during a run) |
| chain-grid `.no-data` | `options/chain` (expired/empty chain) | compact centered no-data row |
| flex-chart `.no-data` | any flex-chart host (analysis views) | **verify 48px padding fits inside the chart's 100%-height host on a small pane — no clipping** |
| heatmap `__empty` | `heatmap-view` with no data | previously unstyled — now renders a canonical state block |
| analysis + scatter + histogram | `trading/analysis` | `.empty-state` split from `.loading-container`; no visual change vs intent |
| triage-report `.error-state` | signal-action-report | canonical error state block |

### S10 — Traceability

| Criterion | Scenario |
|---|---|
| error-banner ×3 with canonical markup | S5 |
| state-block ×17 surfaces | S6, S9 |
| stat-strip ×3 with canonical sb-* markup | S6, S7 |
| `.neg` red specificity fix | S6, S7 |
| dense-table on the three plain tables | S8 |
| spinner dedupe — global keyframes still animate | S9 (run-dashboard) |
| lifecycle-badge / literal retokenization | S8 (instances-table) |
| relay + build + suite green | S1–S4 |

### S11 — Regression / smoke checklist

- [ ] Signal-order page renders fully (no broken layout above/below scoreboard)
- [ ] Allocation dialog opens, tabs/positions render
- [ ] Paper-trading tables still sort via clickable headers
- [ ] Backtest dashboard navigation unaffected
- [ ] No console errors (`NG0304` resolved on options-strategy-dashboard)

## Result log

| Scenario | Result | Evidence |
|---|---|---|
| S1 relay | PASS | 110/110 |
| S2 sibling relays | PASS | 1114: 47/47 · 1115: 30/30 |
| S3 build | PASS | dev build green (post-R2 diff) |
| S4 specs | PASS | full (post-R2 diff): 253/253 suites · 4275/4275; R2 focused: 228/228, NG0304 gone |
| S5 banners | PASS | Method C — compiled-evidence; identical mixin to shipped PD banners, markup + MatIconModule guards green; owner waived live-error check |
| S6–S9 | PASS | user sign-off — in-context visual pass on the migrated surfaces (scoreboard, alloc strips, dense tables, empty states) |
| S11 | PASS | user sign-off — no regressions observed |
