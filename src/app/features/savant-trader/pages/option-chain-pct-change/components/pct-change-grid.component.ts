/**
 * Pct Change Grid Component
 *
 * Renders a single PctChangeGrid as a CSS grid heatmap. Rows are strikes,
 * columns are expirations. Each cell shows the percentage change, starting
 * price, and target price, with colors from pctChangeToCellColors.
 *
 * Standalone Angular component using CSS grid. No charting dependency.
 * Follows the existing heatmap-chart-heatmap.component pattern (divs with
 * [style.background-color]).
 */
import { Component, input, computed, inject, signal, effect, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { CdkConnectedOverlay, Overlay, type ConnectedPosition } from '@angular/cdk/overlay';
import { MatIconModule } from '@angular/material/icon';

import type { PctChangeGrid, PctChangeCell } from '../utils/pct-change.utils';
import { cellKey, CONTRACT_CHART_PANE_CLASS } from '../utils/pct-change.utils';
import { pctChangeToCellColors, DEFAULT_CELL_TEXT_MODE, type CellTextMode } from '../utils/color-mapping.utils';
import { DAYS } from '../../../../shared/utils/date.util';
import { ContractMiniChartComponent } from './contract-mini-chart.component';
import { OptionChainPctChangeStore, sameSelectedCell } from '../option-chain-pct-change.store';
import type { SeriesScope } from '../option-chain-pct-change.store';

/** Cell render data — color, tooltip, and display strings are computed once
 *  per grid change so hover-driven change detection is property reads only. */
interface ViewCell extends PctChangeCell {
  key: string;
  color: string;
  /** Text color override for dark cells ('inherit' = default dark text). */
  fg: string;
  /** Halo text-shadow for dark cells ('none' when unused). */
  shadow: string;
  /** True for the 5 highest positive pctChange cells in this column. */
  isTop: boolean;
  tooltip: string;
  pctText: string;
  priceText: string;
  deltaText: string | null;
}

/** A precomputed row: strike + ordered view cells (null where no contract). */
interface GridRow {
  strike: number;
  /** Precomputed "±N (±X%)" ATM-diff text, null when no ATM strike. */
  atmText: string | null;
  cells: (ViewCell | null)[];
}

/** A precomputed expiration column header. */
interface ExpHeader {
  date: string;
  daysText: string;
  /** 3-letter day of week, e.g. 'Fri'. */
  dowText: string;
}

@Component({
  selector: 'app-pct-change-grid',
  standalone: true,
  imports: [CdkConnectedOverlay, MatIconModule, ContractMiniChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid-header">
      <span class="grid-title">{{ grid().targetDate }} ({{ grid().durationDays }}d from start)</span>
      @if (grid().startUnderlyingPrice != null && grid().targetUnderlyingPrice != null) {
        <span class="underlying-summary">
          {{ formatPrice(grid().startUnderlyingPrice!) }} → {{ formatPrice(grid().targetUnderlyingPrice!) }}
          <span class="underlying-pct" [class.pos]="(underlyingPctChange() ?? 0) > 0" [class.neg]="(underlyingPctChange() ?? 0) < 0">
            ({{ formatPct(underlyingPctChange()!) }})
          </span>
        </span>
      }
    </div>
    @if (grid().cells.size === 0) {
      <div class="no-data">No contracts matched the current filters.</div>
    } @else {
      <div class="grid-scroll">
        <!-- Delegated handlers: one listener set per grid instead of a
             button + icon component + overlay origin + listeners on every
             cell — that per-cell Angular cost hung the browser on large
             chains. The chart icon renders only inside the hovered cell. -->
        <div
          class="grid-body"
          [style.grid-template-columns]="'auto repeat(' + expHeaders().length + ', minmax(50px, 1fr))'"
          (mouseover)="onCellOver($event)"
          (mouseout)="onCellOut($event)"
          (click)="onCellClick($event)"
        >
          <div class="grid-cell header-cell"></div>
          @for (exp of expHeaders(); track exp.date) {
            <div class="grid-cell header-cell">
              <span class="exp-date">{{ exp.date }} {{ exp.dowText }}</span>
              <span class="exp-days">{{ exp.daysText }}</span>
            </div>
          }
          @for (row of rows(); track row.strike) {
            <div class="grid-cell row-header">
              <span class="strike-value">{{ row.strike }}</span>
              @if (row.atmText != null) {
                <span class="atm-diff">{{ row.atmText }}</span>
              }
            </div>
            @for (vc of row.cells; track $index) {
              @if (vc) {
                <div
                  class="grid-cell data-cell"
                  [attr.data-cell-key]="vc.key"
                  [style.background-color]="vc.color"
                  [style.color]="vc.fg"
                  [style.text-shadow]="vc.shadow"
                  [class.top-gainer]="vc.isTop"
                  [class.linked-cell]="vc.key === linkedKey()"
                  [title]="vc.tooltip"
                >
                  <span class="pct-change">{{ vc.pctText }}</span>
                  <span class="price-detail">{{ vc.priceText }}</span>
                  @if (vc.deltaText != null) {
                    <span class="delta-detail">{{ vc.deltaText }}</span>
                  }
                  @if (iconCellKey() === vc.key) {
                    <button
                      type="button"
                      class="chart-icon-btn"
                      aria-label="Show contract price/delta chart"
                    >
                      <mat-icon>show_chart</mat-icon>
                    </button>
                  }
                </div>
              } @else {
                <div class="grid-cell empty-cell"></div>
              }
            }
          }
        </div>
      </div>
    }
    <!-- One overlay per grid (not per cell — an OverlayRef per cell would
         create thousands of position strategies on large grids). It re-
         anchors to whichever data cell last opened it (the cell element,
         not the transient icon, so the anchor survives icon teardown).
         Deferred by @if so the overlay is never built with a null origin. -->
    @if (activeOrigin(); as origin) {
      <ng-template
        cdkConnectedOverlay
        [cdkConnectedOverlayOrigin]="origin"
        [cdkConnectedOverlayOpen]="overlayOpen()"
        [cdkConnectedOverlayPositions]="overlayPositions"
        [cdkConnectedOverlayScrollStrategy]="scrollStrategy"
        [cdkConnectedOverlayPanelClass]="CHART_PANE_CLASS"
      >
        @if (overlayCell(); as oc) {
          <app-contract-mini-chart
            [contractID]="oc.contractID"
            [strike]="oc.strike"
            [expiration]="oc.expiration"
            [type]="seriesScope()?.type ?? store.type()"
            [series]="store.selectedContractSeries()"
            (mouseenter)="onOverlayEnter()"
            (mouseleave)="onOverlayLeave()"
          />
        }
      </ng-template>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 1rem;
      }
      .grid-header {
        padding: 0.15rem 0.4rem;
        font-weight: 600;
        font-size: 0.75rem;
        background: #f5f5f5;
        border-bottom: 1px solid #e0e0e0;
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .grid-title {
        flex-shrink: 0;
      }
      .underlying-summary {
        font-weight: 400;
        font-size: 0.65rem;
        opacity: 0.85;
      }
      .underlying-pct {
        font-weight: 600;
      }
      .underlying-pct.pos {
        color: #0a7c2e;
      }
      .underlying-pct.neg {
        color: #b00;
      }
      .grid-scroll {
        overflow-x: auto;
        max-height: 70vh;
        overflow-y: auto;
      }
      .grid-body {
        display: grid;
        gap: 1px;
        background: #e0e0e0;
        min-width: max-content;
      }
      .grid-cell {
        padding: 1px 3px;
        font-size: 0.55rem;
        background: #fff;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        min-height: 14px;
        line-height: 1.1;
      }
      .header-cell {
        font-weight: 600;
        background: #f5f5f5;
        text-align: center;
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .exp-date {
        font-size: 0.55rem;
      }
      .exp-days {
        font-size: 0.45rem;
        font-weight: 400;
        opacity: 0.7;
      }
      .row-header {
        font-weight: 600;
        background: #f5f5f5;
        text-align: right;
        justify-content: center;
        align-items: flex-end;
        padding-right: 3px;
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .strike-value {
        font-size: 0.55rem;
      }
      .atm-diff {
        font-size: 0.45rem;
        font-weight: 400;
        opacity: 0.6;
      }
      .data-cell {
        cursor: default;
        position: relative;
      }
      .data-cell:hover {
        opacity: 0.85;
      }
      .data-cell.top-gainer {
        box-shadow: inset 0 0 0 2px #000;
      }
      .data-cell.linked-cell {
        box-shadow: inset 0 0 0 2px #1565c0;
      }
      /* Both markers on one cell: outer blue ring + inner black ring —
         later shadows paint under earlier ones. */
      .data-cell.top-gainer.linked-cell {
        box-shadow: inset 0 0 0 2px #1565c0, inset 0 0 0 4px #000;
      }
      .chart-icon-btn {
        position: absolute;
        top: 0;
        right: 0;
        width: 10px;
        height: 10px;
        padding: 0;
        border: none;
        background: transparent;
        cursor: pointer;
        opacity: 0.3;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #444;
      }
      .data-cell:hover .chart-icon-btn,
      .chart-icon-btn:focus-visible {
        opacity: 1;
      }
      .chart-icon-btn mat-icon {
        font-size: 8px;
        width: 8px;
        height: 8px;
        line-height: 8px;
      }
      .empty-cell {
        background: #fafafa;
      }
      .pct-change {
        font-weight: 700;
        font-size: 0.6rem;
      }
      .price-detail {
        font-size: 0.45rem;
        opacity: 0.8;
      }
      .delta-detail {
        font-size: 0.4rem;
        opacity: 0.6;
      }
      .no-data {
        padding: 1rem;
        text-align: center;
        color: #999;
        font-size: 0.8rem;
      }
    `,
  ],
})
export class PctChangeGridComponent implements OnDestroy {
  /** The grid to render. */
  readonly grid = input.required<PctChangeGrid>();

  /** How cell text stays legible on dark cells: adaptive white text,
   *  brighter ramp endpoints, or a halo behind dark text. */
  readonly contrastMode = input<CellTextMode>(DEFAULT_CELL_TEXT_MODE);

  /** Key (strike-expiration) of the contract selected in a sibling grid —
   *  the matching cell here gets a blue outline. Null = no highlight. */
  readonly linkedKey = input<string | null>(null);

  /** Run-grid scope — when set (swing-compare run sections), the chart
   *  popup's series + type come from the run's dates/type instead of the
   *  main-flow inputs. */
  readonly seriesScope = input<SeriesScope | null>(null);

  /** Store — event emission only (icon hover/click → selection methods);
   *  the overlay reads selectedCell/selectedContractSeries/type directly. */
  readonly store = inject(OptionChainPctChangeStore);
  private readonly overlay = inject(Overlay);

  /**
   * Grace delay before a leave clears the preview. The pane attaches on the
   * next CD pass and sits a few px from the icon, so a pointer moving
   * icon → gap → pane must not snap the preview shut mid-transit. Cancelled
   * by entering the pane or any icon.
   */
  private static readonly CLEAR_DELAY_MS = 200;
  /** CDK panel class for the chart popup — shared by the overlay config
   *  and the leave/dismiss guards. */
  readonly CHART_PANE_CLASS = CONTRACT_CHART_PANE_CLASS;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  /** Keep the chart popup tracking its cell while the grid scrolls. */
  readonly scrollStrategy = this.overlay.scrollStrategies.reposition();

  /** Prefer below-right of the icon, flip above or left when cramped. */
  readonly overlayPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  /** Precomputed expiration headers — one per column, days resolved once. */
  readonly expHeaders = computed<ExpHeader[]>(() =>
    this.grid().expirations.map((date) => ({
      date,
      daysText: `${this.daysFromStart(date)}d`,
      dowText: DAYS[new Date(date + 'T00:00:00Z').getUTCDay()],
    })),
  );

  /** Precomputed row matrix: one row per strike, view cells ordered by
   *  expiration with all display strings resolved up front. */
  readonly rows = computed<GridRow[]>(() => {
    const g = this.grid();
    const mode = this.contrastMode();
    // Top-5 gainers per column (expiration) — highest positive pctChange
    // cells among that column's strikes.
    const top = new Set<string>();
    for (const exp of g.expirations) {
      const column = g.strikes
        .map((s) => g.cells.get(cellKey(s, exp)))
        .filter((c): c is PctChangeCell => c != null && c.pctChange > 0)
        .sort((a, b) => b.pctChange - a.pctChange)
        .slice(0, 5);
      for (const c of column) top.add(cellKey(c.strike, c.expiration));
    }
    return g.strikes.map((strike) => ({
      strike,
      atmText: this.atmDiff(strike) != null ? this.formatAtmDiff(strike) : null,
      cells: g.expirations.map((exp) => {
        const cell = g.cells.get(cellKey(strike, exp));
        if (!cell) return null;
        const colors = pctChangeToCellColors(cell.pctChange, g.p5, g.p95, mode);
        const key = cellKey(strike, exp);
        return {
          ...cell,
          key,
          color: colors.bg,
          fg: colors.fg,
          shadow: colors.shadow,
          isTop: top.has(key),
          tooltip: this.cellTooltip(cell),
          pctText: this.formatPct(cell.pctChange),
          priceText: `${this.formatPrice(cell.startPrice)} → ${this.formatPrice(cell.targetPrice)}`,
          deltaText:
            cell.delta != null || cell.targetDelta != null
              ? `Δ${this.formatDelta(cell.delta)} → Δ${this.formatDelta(cell.targetDelta)}`
              : null,
        } satisfies ViewCell;
      }),
    }));
  });

  /** Underlying price pct change from start to target. */
  readonly underlyingPctChange = computed(() => {
    const g = this.grid();
    if (g.startUnderlyingPrice == null || g.targetUnderlyingPrice == null) return null;
    if (g.startUnderlyingPrice === 0) return null;
    return ((g.targetUnderlyingPrice - g.startUnderlyingPrice) / g.startUnderlyingPrice) * 100;
  });

  /** Days from the start date to the given expiration. */
  daysFromStart(expiration: string): number {
    const s = new Date(this.grid().startDate + 'T00:00:00Z');
    const e = new Date(expiration + 'T00:00:00Z');
    return Math.round((e.getTime() - s.getTime()) / 86_400_000);
  }

  /** Amount difference from ATM strike. */
  atmDiff(strike: number): number | null {
    const atm = this.grid().atmStrike;
    if (atm == null) return null;
    return strike - atm;
  }

  /** Percentage difference from ATM strike. */
  atmPctDiff(strike: number): number | null {
    const atm = this.grid().atmStrike;
    if (atm == null || atm === 0) return null;
    return ((strike - atm) / atm) * 100;
  }

  /** Format a delta for display in a cell. */
  formatDelta(delta: number | null): string {
    if (delta == null) return '';
    return delta.toFixed(2);
  }

  /** Format the ATM diff: amount and percentage. */
  formatAtmDiff(strike: number): string {
    const diff = this.atmDiff(strike);
    if (diff == null) return '';
    const pct = this.atmPctDiff(strike);
    const sign = diff > 0 ? '+' : '';
    const pctStr = pct != null ? ` (${sign}${pct.toFixed(1)}%)` : '';
    return `${sign}${diff.toFixed(0)}${pctStr}`;
  }

  /** Overlay anchor + content: the data-cell element (and its cell) that
   *  last opened the shared overlay. Signals so template bindings
   *  re-evaluate. The cell element — not the transient icon — is the anchor
   *  so it survives icon teardown when the pointer moves into the pane. */
  readonly activeOrigin = signal<HTMLElement | null>(null);
  readonly overlayCell = signal<PctChangeCell | null>(null);
  /** data-cell-key of the cell currently showing the chart icon, or null.
   *  At most one icon exists in the grid at a time. */
  readonly iconCellKey = signal<string | null>(null);

  /** Shared overlay is open when the store's selection matches the cell
   *  that opened it AND belongs to this grid's target date. */
  readonly overlayOpen = computed(() => {
    const c = this.overlayCell();
    return (
      c != null &&
      sameSelectedCell(
        this.store.selectedCell(),
        c,
        this.grid().targetDate,
        this.seriesScope() ?? undefined,
      )
    );
  });

  ngOnDestroy(): void {
    this.cancelPendingClear();
    // A destroyed grid can't host its popup — if our cell owns the
    // selection (e.g. a pinned run grid collapsed), release it so other
    // grids aren't stuck behind a dead pin.
    if (this.overlayCell() != null) this.store.clearContractSelection();
  }

  constructor() {
    // A grid() change re-renders the cells and destroys the icon element —
    // drop the captured anchor so the shared overlay can't bind to a dead
    // origin (the store clears the selection on grid changes too).
    effect(() => {
      this.grid();
      this.activeOrigin.set(null);
      this.overlayCell.set(null);
      this.iconCellKey.set(null);
    });
  }

  /**
   * Delegated pointer-enter on the grid body. Entering a data cell reveals
   * its chart icon; entering the icon anchors the shared overlay to the
   * cell element and previews the contract (no-ops while pinned: the
   * pinned cell keeps its anchor). Cancels any pending clear so a
   * leave→enter sweep can't wipe the new selection.
   */
  onCellOver(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const cellEl = target?.closest<HTMLElement>('.data-cell');
    const key = cellEl?.getAttribute('data-cell-key');
    if (!target || !cellEl || !key) return;

    if (target.closest('.chart-icon-btn')) {
      const cell = this.grid().cells.get(key);
      if (!cell) return;
      this.cancelPendingClear();
      if (this.store.isContractPinned()) return;
      // Skip re-patching when this cell is already the selection — the
      // bubbling mouseover refires on every internal move within the icon.
      if (sameSelectedCell(this.store.selectedCell(), cell, this.grid().targetDate, this.seriesScope() ?? undefined)) {
        return;
      }
      this.activeOrigin.set(cellEl);
      this.overlayCell.set(cell);
      this.store.previewContract(cell, this.grid().targetDate, this.seriesScope() ?? undefined);
      return;
    }

    if (this.iconCellKey() !== key) this.iconCellKey.set(key);
  }

  /**
   * Delegated pointer-leave on the grid body. Leaving a cell hides its
   * icon; leaving the icon — even into its own cell — schedules a clear
   * unless pinned or the pointer moved straight into this grid's chart
   * pane. The grace delay covers the attach gap and the few px between
   * icon and pane.
   */
  onCellOut(event: MouseEvent): void {
    const from = event.target as HTMLElement | null;
    const to = event.relatedTarget as HTMLElement | null;
    const fromCell = from?.closest('.data-cell') ?? null;
    const sameCell = fromCell != null && to?.closest('.data-cell') === fromCell;

    if (
      fromCell &&
      !sameCell &&
      this.iconCellKey() === fromCell.getAttribute('data-cell-key')
    ) {
      this.iconCellKey.set(null);
    }

    const leftIcon =
      from?.closest('.chart-icon-btn') != null &&
      to?.closest('.chart-icon-btn') == null;
    if (!leftIcon) return;
    if (this.store.isContractPinned()) return;
    if (to?.closest(`.${this.CHART_PANE_CLASS}`)) return;
    this.scheduleClear();
  }

  /**
   * Delegated click on the grid body. Clicking the rendered icon pins the
   * overlay open on its cell and stops propagation so the page's
   * document-click dismissal doesn't close it. Clicking a cell body with
   * no icon rendered (touch) reveals the icon first — a second tap pins.
   */
  onCellClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const cellEl = target?.closest<HTMLElement>('.data-cell');
    const key = cellEl?.getAttribute('data-cell-key');
    if (!target || !cellEl || !key) return;

    if (target.closest('.chart-icon-btn')) {
      const cell = this.grid().cells.get(key);
      if (!cell) return;
      event.stopPropagation();
      this.cancelPendingClear();
      this.store.highlightContract(cell);
      if (this.store.isContractPinned()) return;
      this.activeOrigin.set(cellEl);
      this.overlayCell.set(cell);
      this.store.pinContract(cell, this.grid().targetDate, this.seriesScope() ?? undefined);
    } else {
      // Plain cell click: reveal the icon and highlight this contract
      // across all grids. stopPropagation keeps the page's outside-click
      // dismissal from clearing the highlight on this same click.
      event.stopPropagation();
      this.iconCellKey.set(key);
      const cell = this.grid().cells.get(key);
      if (cell) this.store.highlightContract(cell);
    }
  }

  /** Pointer entering the chart pane cancels a pending clear. */
  onOverlayEnter(): void {
    this.cancelPendingClear();
  }

  /** Pointer leaving the chart pane schedules a clear unless pinned —
   *  the delay lets a pane → icon move re-enter without a flicker. */
  onOverlayLeave(): void {
    if (!this.store.isContractPinned()) this.scheduleClear();
  }

  private scheduleClear(): void {
    this.cancelPendingClear();
    this.clearTimer = setTimeout(() => {
      this.clearTimer = null;
      if (!this.store.isContractPinned()) this.store.clearContractSelection();
    }, PctChangeGridComponent.CLEAR_DELAY_MS);
  }

  private cancelPendingClear(): void {
    if (this.clearTimer != null) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
  }

  /** Build a hover tooltip with full contract details. */
  cellTooltip(cell: PctChangeCell): string {
    const deltaStr = cell.delta == null ? 'N/A' : cell.delta.toFixed(3);
    return [
      `Contract: ${cell.contractID}`,
      `Strike: ${cell.strike}`,
      `Expiration: ${cell.expiration}`,
      `Delta: ${deltaStr}`,
      `Start: ${this.formatPrice(cell.startPrice)}`,
      `Target: ${this.formatPrice(cell.targetPrice)}`,
      `Change: ${this.formatPct(cell.pctChange)}`,
    ].join('\n');
  }

  /** Format a percentage for display (handles negative zero). */
  formatPct(pct: number): string {
    const v = Math.abs(pct) < 0.05 ? 0 : pct;
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(1)}%`;
  }

  /** Format a price for display (handles negative zero). */
  formatPrice(price: number): string {
    const v = Math.abs(price) < 0.005 ? 0 : price;
    return `$${v.toFixed(2)}`;
  }
}
