**Topic:** Portfolio Allocation  
**Topic Slug:** `portfolio-allocation`  
**Thread:** Portfolio Visual Consistency  
**Thread Slug:** `visual-consistency`  
**Issue:** #773  
**Thread Parent:** #751  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** IMPL: FE  
**Status:** Draft  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-03  

---

## Approach

Migrate `features/portfolio-dashboard/` to the run-dashboard / signal-review visual language. The common blocks live in one feature-scoped SCSS partial; per-component SCSS keeps what is actually component-specific. No behavior changes except the account-switcher relocation. Pure FE area — no BE/SHARED work.

## File Structure

```
features/portfolio-dashboard/
  styles/
    _pd-visual-language.scss     ← NEW: shared blocks (feature-internal only)
  portfolio-dashboard.component.{ts,html,scss}
  allocation-page.component.ts
  allocation-buckets-table.component.ts
  allocation-positions-table.component.ts
  allocation-bucket-dialog.component.ts
  allocation-assign-dialog.component.ts
  allocation-bucket-detail-dialog.component.ts
  components/
    account-summary.component.*
    equity-positions-table.component.*
    option-positions-table.component.*
    open-orders-table.component.*
    order-history-table.component.*
    close-position-dialog/
    stop-loss-dialog/
```

## `_pd-visual-language.scss` — shared blocks

Consume via `@use 'styles/pd-visual-language' as vl` from each migrated component's SCSS; exposed as mixins (compiled per-component, zero runtime difference). Blocks:

| Mixin | Content | Source convention |
|---|---|---|
| `page-shell()` | flex column, `height:100%`, `overflow:hidden`, `background: var(--mat-sys-surface)` | run-dashboard `.run-dashboard` |
| `content-column()` | `max-width:1100px; margin:0 auto` | run-dashboard `.dashboard-content` |
| `header-bar()` | `padding:8px 16px; surface-container-high; border-bottom outline-variant`; 16px/600 title; 20px primary icon; 32px controls | run-dashboard `.dashboard-header` |
| `dense-table()` | `border-collapse; font-size:12px`; sticky thead on `surface-container`; 11px/600/uppercase headers; `outline-variant` hairlines; `td` 5–6px/10px; `tabular-nums`; `surface-container-low` row hover | signal-table |
| `state-block()` | centered loading/empty/error, `on-surface-variant`, 36px dimmed icon | signal-review `.empty-state` |
| `error-banner()` | token-based error surface (`error-container` / `on-error-container`) replacing hard-coded red | — new, tokenized |

Contents of this file = the duplication inventory the future design-system Topic generalizes.

## Token rules

- All color/spacing values use `--mat-sys-*` tokens — no `rgba(0,0,0,…)`, no hex greys, no light-theme assumptions.
- **P&L / direction colors:** the reference `signal-table` uses literal `#4caf50`/`#f44336` for direction accents. Follow that convention — a shared `vl` accent token pair (`up`/`down` or `pos`/`neg`) defined once in the partial so the future theme pass has one place to retoken them.

## Per-surface changes

### `portfolio-dashboard.component` (`/portfolio`)

- `.pd-header` → `vl.header-bar()` — icon + 16px title "Portfolio" + account toggle + refresh control.
- `.pd-root` → `vl.page-shell()`; content → `vl.content-column()`.
- **Account tabs → `mat-button-toggle-group` in the header bar.** Labels render `acct.accountName` only (Investing / acct-02 / Agentic — no account number). Selected account's tab-content block renders directly below the header (no per-tab wrapper). Non-agentic flag: small chip inside the toggle label, same tooltip/ARIA as today.
- Summary bar, error banner, empty state → tokens (`vl.error-banner()`, `vl.state-block()`).
- mat-tab-group for accounts is **removed** entirely on this page.

### `allocation-page.component` (`/portfolio-allocation`)

- Same header-bar + account-toggle pattern; refresh button moves into header actions.
- **Account header strip stays inline** below the header (value/allocated/cash/unassigned/as-of) — it's data, not nav — restyled as a compact strip on `surface-container` with hairline separators.
- Account `mat-tab-group` removed; Buckets | Positions becomes the page's single `mat-tab-group` (styled tabs, no content-slide animation — `animationDuration="0"`).
- Retired-buckets collapsible section restyled to token chrome.

### Tables (signal-table density via `vl.dense-table()`)

- `allocation-buckets-table` (incl. expando mini-table + totals row), `allocation-positions-table`, `equity-positions-table`, `option-positions-table`, `open-orders-table`, `order-history-table`.
- Keep: right-aligned numeric columns, expando mechanics, existing column sets. Change: padding, font sizes, sticky headers, borders, hover, tokens.

### Dialogs

- `allocation-bucket-dialog` (create/edit), `allocation-assign-dialog`, `allocation-bucket-detail-dialog`, `close-position-dialog`, `stop-loss-dialog` → token colors + compact density consistent with reference dialog chrome (mat-form-field density, stroked buttons).

## Motion policy

- All `mat-tab-group` content-slide animations → `animationDuration="0"` (or removed where the tab-group is removed).
- Expando row open/close motion retained.
- Any remaining decorative transitions removed; panel-resize eases (if any) ≤0.2s.

## Task decomposition

| # | Task | Depends on |
|---|------|------------|
| 1 | `_pd-visual-language.scss` — shared partial + mixins | — |
| 2 | Dashboard page shell — header bar, 1100px column, tokenized summary/states | 1 |
| 3 | Account switcher — button-toggle in header bar on both pages; non-agentic flag; account tabs removed | 1 |
| 4 | Allocation page shell — header bar, inline account-header strip, single Buckets\|Positions tab row, retired section chrome | 1, 3 |
| 5 | Tables → dense-table convention (6 tables incl. expando mini-table) | 1 |
| 6 | Dialogs → token/density pass (5 dialogs) | 1 |

Tasks are presentation-level; specs should need only selector/structural updates where markup changes (account toggle, tab removal, header bar).

## Risks

- **mat-button-toggle styling** in a header bar is new for the codebase — verify compact density reads correctly against `surface-container-high`.
- **Non-agentic flag discoverability** — flag moves from an always-visible tab label into a toggle label; verify it still renders per-account.
- **Spec fallout** — account-tab test IDs (`acct-tab-*`, `account-tabs`) move to toggle semantics; update specs in the same tasks.
- **Overlap with uncommitted #693 work** — buckets-table expando/totals changes are uncommitted; task 5 edits the same file. Land #693 first or reconcile.

## Verification

- `npx jest src/app/features/portfolio-dashboard` — full feature suite green.
- `ng build` clean (SCSS compile of the new partial).
- Visual: `/portfolio` and `/portfolio-allocation` match the reference surfaces; dark theme renders correctly.
