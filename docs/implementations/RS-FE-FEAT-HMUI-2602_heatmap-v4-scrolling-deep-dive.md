---
title: Relative Strength Heatmap v4 – Scrolling Implementation Guide
summary: Onboarding guide for Heatmap v4 scrolling. Covers use case/scale, CDK Virtual Scroll basics, our single-owner scroll model, header/body sync, sticky first column, overlay separators, first-paint alignment, and file-annotated code examples.
---

# Relative Strength Heatmap v4 – Implementation Guide (Onboarding)

This document onboards new team members to the Relative Strength (RS) Heatmap v4 rendering. It assumes working Angular knowledge but not Angular CDK familiarity.

## What you’ll learn
- Why we enforce a single scroll owner per axis.
- How intrinsic sizing (`max-content`) yields a true horizontal scroll width over thousands of columns.
- How we keep grid lines crisp using overlay pseudo-elements (no layout borders).
- How we stabilize first paint when a vertical scrollbar appears.
- How the sticky left pair column integrates with the virtual scroll for vertical scrolling.

Screenshot note: The UI achieves both horizontal and vertical scrolling within a fixed viewport, with the first (pair) column sticky and the date header horizontally synced with the heatmap cells.

# 1. Goals
- Single scroll owner per axis to prevent drift.
- Pixel-accurate header/body alignment at all zoom/DPR levels.
- Sticky first column; header that scrolls horizontally but never vertically.
- No layout-affecting vertical borders; draw crisp grid overlays instead.
- Stable initial render (no first-paint misalignment), including when vertical scrollbar appears.

## 1a. Use Case, Scale, and Constraints
- Universe size: ~1150 symbol pairs overall. Typical SPY cohort display: ~500 rows.
- Timeframes: Daily, Weekly, Monthly. Data begins at 2019-01-01.
- Scale implications: Daily spans thousands of columns; Weekly/Monthly hundreds. The UI must support smooth pans through ~3,000 columns while keeping header/body precisely aligned.

Approximate SPY cohort cell counts (500 rows back to 2019-01-01):

| Timeframe | Columns (approx.) | Rows | Total Cells (approx.) |
|---|---:|---:|---:|
| Daily | ~1,800 | 500 | ~900,000 |
| Weekly | ~370 | 500 | ~185,000 |
| Monthly | ~86 | 500 | ~43,000 |

Screenshot note: This implementation achieves both horizontal and vertical scrolling within a fixed viewport window. The first column (pair) is sticky; the date header scrolls horizontally in sync with the heatmap cells.

## 1b. Angular CDK Virtual Scroll – Primer (Vanilla)
Angular CDK Virtual Scroll mounts only the visible rows. Key rules: `[itemSize]` must match true row height; the viewport should be the only vertical scroller; horizontal overflow can live inside each row with intrinsic width.

```ts
// File: app/example/vanilla-viewport.component.ts
@Component({
  standalone: true,
  template: `
    <cdk-virtual-scroll-viewport [itemSize]="rowH" class="viewport">
      <div *cdkVirtualFor=\"let item of items\" class=\"row\">{{ item }}</div>
    </cdk-virtual-scroll-viewport>
  `,
})
export class VanillaViewportComponent {
  rowH = 30; // px; must equal CSS height
  items = Array.from({ length: 10000 }, (_, i) => `Row ${i}`);
}
```

## 1c. RS Heatmap – Goals and Issues We Solved
- Goals
  - Sticky first column (pair name), fixed horizontally.
  - Date header that scrolls horizontally in perfect lockstep with the heatmap cells.
  - Smooth vertical scrolling using CDK Virtual Scroll; header/left never own vertical scroll.
  - Crisp per‑cell separators and higher‑level grouping (week, month, year) without affecting layout.
- Issues addressed
  - Header/body drift from dual horizontal scroll owners.
  - Horizontal scrollbar not appearing due to intrinsic width collapse or internal padding.
  - Fuzzy vertical lines from gradient backgrounds; replaced with overlay separators.
  - First‑paint misalignment when the body’s vertical scrollbar appears; fixed by measured spacer + double rAF before auto‑scroll.

## 1d. Reader’s Map: What Scrolls and Why
- Vertical scroll owner: `cdk-virtual-scroll-viewport` (body only). The sticky pair column participates in the same row DOM and stays visually fixed using `position: sticky; left: 0;`, while the viewport handles vertical movement and windowing.
- Horizontal scroll owner: the body’s inner scroll container. The header (month band + date row) is passive and mirrors `scrollLeft` via code. A reentrancy guard prevents event ping‑pong.

# 1e. File Tree and Where Code Lives

```
docs/
  implementations/
    RS-FE-FEAT-HMUI-2602_heatmap-v4-scrolling-deep-dive.md   <- this guide
    RS-FE-FEAT-HMUI-2602_heatmap-v3-virtualization-plan.md   <- prior plan doc (links to v4)
src/
  app/
    features/
      dashboard-v3/
        heatmap-v4/
          heatmap-v4.component.html   <- DOM layout, header/body structure, sticky column markup
          heatmap-v4.component.scss    <- CSS variables, intrinsic sizing, overlays, grouping lines
          heatmap-v4.component.ts      <- scroll ownership/sync, scrollbar measure, auto-scroll
        heatmap-v3/                    <- legacy v3 for reference only
```

All code blocks in this guide are annotated with file paths. When you copy snippets, ensure paths match this tree.

# 2. DOM Layout (Authoritative Structure)
At a glance: the body viewport owns vertical scrolling and horizontal overflow. The header is a non‑scrolling container that mirrors `scrollLeft` from the body. The first (pair) column is part of each row and uses `position: sticky` to remain fixed while the rest of the row scrolls horizontally.
```html
<!-- File: src/app/features/dashboard-v3/heatmap-v4/heatmap-v4.component.html -->
<div class="heatmap-wrapper">
  <div class="heatmap-header-container" #headerContainer (scroll)="onHeaderScroll($event)">
    <div class="month-band-row">
      <div class="month-band-cell corner-cell sticky-left"></div>
      <div class="month-band-data">
        <!-- Month/Year groups rendered here (width: max-content) -->
        <div class="month-scrollbar-spacer"></div> <!-- width == body vertical scrollbar -->
      </div>
    </div>

    <div class="heatmap-row header-row">
      <div class="header-cell sticky-left">Symbol/Date</div>
      <div class="header-data" #centerHeader>
        <!-- One header cell per column (width: var(--heatmap-cell-width)) -->
        <div class="header-scrollbar-spacer"></div> <!-- width == body vertical scrollbar -->
      </div>
    </div>
  </div>

  <cdk-virtual-scroll-viewport #bodyViewport class="heatmap-body-viewport" [itemSize]="30" (scroll)="onBodyScroll($event)">
    <div *cdkVirtualFor="let row of rows" class="heatmap-row data-row">
      <div class="heatmap-cell sticky-left pair-name-cell">{{ row.key }}</div>
      <div class="data-cells-container">
        <!-- One .heatmap-cell per column (width: var(--heatmap-cell-width)) -->
      </div>
    </div>
  </cdk-virtual-scroll-viewport>

</div>
```

## 2.1 Horizontal Sync and Sticky Pair Column
- Horizontal sync: The body is the source of truth. In `onBodyScroll`, copy `body.scrollLeft` → `header.scrollLeft` and set `--heatmap-grid-offset = -(scrollLeft % cellWidth)` so overlay separators in header/body phase‑lock at any zoom/DPR. If a header scroll occurs, `onHeaderScroll` mirrors back to body. A boolean guard prevents event ping‑pong.
- Sticky pair column and vertical scroll: Each row contains the left pair cell and data cells. The viewport owns vertical scrolling; the left cell stays visible with `position: sticky; left: 0;`. Because both live in the same row, there is no vertical drift.

Key invariants:
- Header container never owns vertical scroll (overflow-y: hidden).
- Body viewport is the only vertical scroll owner.
- Body content owns horizontal scroll; header mirrors `scrollLeft`.
- Intrinsic sizing via `width: max-content` ensures real overflow width equals total columns × cell width.

# 3. CSS Variables & Sizing Contracts
```scss
/* File: src/app/features/dashboard-v3/heatmap-v4/heatmap-v4.component.scss */
:host {
  --heatmap-first-col-width: 100px;
  --heatmap-cell-height: 30px; // matches [itemSize]
  --heatmap-cell-width: 60px;  // fixed width per column
  --heatmap-month-band-height: calc(var(--heatmap-cell-height) * 0.66);
  --heatmap-trailing-space: 24px; // outside margin on wrapper
  --heatmap-vert-scrollbar: 0px;  // measured at runtime
}
```
- Fixed width/height remove rounding drift in header vs body.
- `--heatmap-vert-scrollbar` is injected from TS so header/month band can reserve the same right-end space the body loses to the vertical scrollbar.

# 4. SCSS Essentials (No Layout-Affecting Borders)
- Intrinsic width + no gaps/padding on scroll owners:
```scss
/* File: src/app/features/dashboard-v3/heatmap-v4/heatmap-v4.component.scss */
.heatmap-wrapper { width: calc(100% - var(--heatmap-trailing-space)); margin-right: var(--heatmap-trailing-space); }
.heatmap-header-container { overflow-x: hidden; overflow-y: hidden; }
.heatmap-body-viewport { overflow-x: auto; scrollbar-gutter: stable; }
.header-data, .month-band-data, .data-cells-container { width: max-content; gap: 0; margin: 0; padding: 0; }
.cdk-virtual-scroll-content-wrapper { display: inline-block; width: max-content; min-width: 100%; }
```
- Sticky first column (same width everywhere):
```scss
/* File: src/app/features/dashboard-v3/heatmap-v4/heatmap-v4.component.scss */
.sticky-left { position: sticky; left: 0; width: var(--heatmap-first-col-width); min-width: var(--heatmap-first-col-width); z-index: 2; }
```
- Grid overlays: per cell, never borders that change layout width:
```scss
/* File: src/app/features/dashboard-v3/heatmap-v4/heatmap-v4.component.scss */
.header-cell, .heatmap-cell { position: relative; min-width: var(--heatmap-cell-width); width: var(--heatmap-cell-width); flex: 0 0 var(--heatmap-cell-width); }
.header-cell::after, .heatmap-cell::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 1px; background: black; pointer-events: none; }
/* Grouping lines */
.header-cell.week-start::before, .heatmap-cell.week-start::before { content:''; position:absolute; left:0; top:0; bottom:0; width:2px; background:black; }
.header-cell.month-start::before, .heatmap-cell.month-start::before { content:''; position:absolute; left:0; top:calc(-1 * var(--heatmap-month-band-height)); bottom:0; width:1px; background:black; }
.header-cell.year-start::before, .heatmap-cell.year-start::before { content:''; position:absolute; left:0; top:calc(-1 * var(--heatmap-month-band-height)); bottom:0; width:2px; background:black; }
```
- Header/month band right spacers sized by `--heatmap-vert-scrollbar`:
```scss
/* File: src/app/features/dashboard-v3/heatmap-v4/heatmap-v4.component.scss */
.header-scrollbar-spacer, .month-scrollbar-spacer { flex: 0 0 var(--heatmap-vert-scrollbar); width: var(--heatmap-vert-scrollbar); height: 1px; }
```

# 5. TypeScript: Scroll Ownership, Sync, and Phase Lock
- Reentrancy guard prevents ping-pong:
```ts
// File: src/app/features/dashboard-v3/heatmap-v4/heatmap-v4.component.ts
private isSyncingScroll = false;
readonly CELL_WIDTH_PX = 60; // must match CSS var

onBodyScroll(event: Event): void {
  if (this.isSyncingScroll) return;
  const target = event.target as HTMLElement;
  const headerEl = this.headerContainer()?.nativeElement;
  if (!headerEl) return;
  this.isSyncingScroll = true;
  headerEl.scrollLeft = target.scrollLeft;
  const phase = -(target.scrollLeft % this.CELL_WIDTH_PX);
  this.hostEl.nativeElement.style.setProperty('--heatmap-grid-offset', `${phase}px`);
  requestAnimationFrame(() => { this.isSyncingScroll = false; });
}

onHeaderScroll(event: Event): void {
  if (this.isSyncingScroll) return;
  const target = event.target as HTMLElement;
  const bodyEl = this.bodyViewport()?.elementRef.nativeElement as HTMLElement | undefined;
  if (!bodyEl) return;
  this.isSyncingScroll = true;
  bodyEl.scrollLeft = target.scrollLeft;
  const phase = -(target.scrollLeft % this.CELL_WIDTH_PX);
  this.hostEl.nativeElement.style.setProperty('--heatmap-grid-offset', `${phase}px`);
  requestAnimationFrame(() => { this.isSyncingScroll = false; });
}
```
- Measure vertical scrollbar and expose `--heatmap-vert-scrollbar`:
```ts
// File: src/app/features/dashboard-v3/heatmap-v4/heatmap-v4.component.ts
private ro?: ResizeObserver;
private readonly boundResize = () => this.updateVertScrollbarWidth();

ngAfterViewInit(): void {
  this.observeViewportScrollbar();
}
ngOnDestroy(): void {
  this.ro?.disconnect();
  window.removeEventListener('resize', this.boundResize);
}

private observeViewportScrollbar(): void {
  this.updateVertScrollbarWidth();
  const el = this.bodyViewport()?.elementRef.nativeElement as HTMLElement | undefined;
  if (!el) return;
  this.ro = new ResizeObserver(() => this.updateVertScrollbarWidth());
  this.ro.observe(el);
  window.addEventListener('resize', this.boundResize, { passive: true });
}

private updateVertScrollbarWidth(): void {
  const el = this.bodyViewport()?.elementRef.nativeElement as HTMLElement | undefined;
  if (!el) return;
  const scrollbar = Math.max(0, el.offsetWidth - el.clientWidth);
  this.hostEl.nativeElement.style.setProperty('--heatmap-vert-scrollbar', `${scrollbar}px`);
}
```
- First-paint stability: measure spacer first, then auto-scroll:
```ts
// File: src/app/features/dashboard-v3/heatmap-v4/heatmap-v4.component.ts
private didAutoScrollForLoad = false;

private scheduleAutoScrollToEnd(): void {
  if (this.didAutoScrollForLoad) return;
  requestAnimationFrame(() => {
    this.updateVertScrollbarWidth(); // rAF #1
    requestAnimationFrame(() => {   // rAF #2 after CSS var applies
      const bodyEl = this.bodyViewport()?.elementRef.nativeElement as HTMLElement | undefined;
      const headerEl = this.headerContainer()?.nativeElement as HTMLElement | undefined;
      if (!bodyEl) return;
      const maxScroll = bodyEl.scrollWidth - bodyEl.clientWidth;
      if (maxScroll > 0) {
        this.isSyncingScroll = true;
        bodyEl.scrollTo({ left: bodyEl.scrollWidth, behavior: 'auto' });
        headerEl && headerEl.offsetWidth; // force layout read
        if (headerEl) headerEl.scrollLeft = bodyEl.scrollLeft;
        const phase = -(bodyEl.scrollLeft % this.CELL_WIDTH_PX);
        this.hostEl.nativeElement.style.setProperty('--heatmap-grid-offset', `${phase}px`);
        requestAnimationFrame(() => { this.isSyncingScroll = false; });
        this.didAutoScrollForLoad = true;
      }
    });
  });
}
```

# 6. Template Bindings (Higher-Level Grouping)
- Daily: group by week (week-start = Monday).
- Weekly: group by month (month-start when crossing month boundary).
- Monthly: group by year (year-start when crossing year boundary).
```html
<!-- File: src/app/features/dashboard-v3/heatmap-v4/heatmap-v4.component.html -->
<div class="header-cell data-header"
     [class.week-start]="h.weekStart"
     [class.month-start]="monthStartMap()[h.raw] === true"
     [class.year-start]="yearStartMap()[h.raw] === true">
  ...
</div>

<div class="heatmap-cell data-cell"
     [class.week-start]="weekStartMap()[datum.date] === true"
     [class.month-start]="monthStartMap()[datum.date] === true"
     [class.year-start]="yearStartMap()[datum.date] === true">
  ...
</div>
```

# 7. Common Pitfalls & Fixes
- Two scroll owners per axis → drift. Keep single-owner: body horizontal + body vertical.
- Borders/padding on scroll containers → off-by-one visual shifts. Use overlays and zero padding/gaps.
- First render misalignment due to scrollbar width → measure-and-apply spacer before syncing scroll.
- Intrinsic width collapse → use `width: max-content` on row/headers + `inline-block` on CDK wrapper.
- DPR rounding → phase-lock overlays with `scrollLeft % cellWidth`.

# 8. Testing Checklist
- Load at various DPRs/zooms; header/body separators remain phase-locked.
- Toggle vertical scrollbar (e.g., triple rows debug or smaller viewport); header right spacer matches body.
- Auto-scroll-to-end lands exactly at far right; no drift when you move the slider slightly.
- Sticky-left remains aligned during fast vertical scrolls.
- Grouping lines (week 2px, month 1px, year 2px) remain continuous from top of month band through body.

# 9. Optional Enhancements
- Query param toggle `?tripleRows=1` for row multiplication.
- Theme variables for `--heatmap-month-separator` and `--heatmap-year-separator` for lighter/darker accents.
- Horizontal windowing for the time axis once UI stability is locked in (v4 follow-up).
