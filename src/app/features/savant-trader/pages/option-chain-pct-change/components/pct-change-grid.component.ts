/**
 * Pct Change Grid Component
 *
 * Renders a single PctChangeGrid as a CSS grid heatmap. Rows are strikes,
 * columns are expirations. Each cell shows the percentage change, starting
 * price, and target price, with a background color from pctChangeToColor.
 *
 * Standalone Angular component using CSS grid. No charting dependency.
 * Follows the existing heatmap-chart-heatmap.component pattern (divs with
 * [style.background-color]).
 */
import { Component, input, computed, inject, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { CdkConnectedOverlay, CdkOverlayOrigin, Overlay, type ConnectedPosition } from '@angular/cdk/overlay';
import { MatIconModule } from '@angular/material/icon';

import type { PctChangeGrid, PctChangeCell } from '../utils/pct-change.utils';
import { cellKey } from '../utils/pct-change.utils';
import { pctChangeToColor } from '../utils/color-mapping.utils';
import { ContractMiniChartComponent } from './contract-mini-chart.component';
import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';

/** A precomputed row: strike + ordered cells (null where no contract). */
interface GridRow {
  strike: number;
  cells: (PctChangeCell | null)[];
}

@Component({
  selector: 'app-pct-change-grid',
  standalone: true,
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, MatIconModule, ContractMiniChartComponent],
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
        <div
          class="grid-body"
          [style.grid-template-columns]="'auto repeat(' + grid().expirations.length + ', minmax(50px, 1fr))'"
        >
          <div class="grid-cell header-cell"></div>
          @for (exp of grid().expirations; track exp) {
            <div class="grid-cell header-cell">
              <span class="exp-date">{{ exp }}</span>
              <span class="exp-days">{{ daysFromStart(exp) }}d</span>
            </div>
          }
          @for (row of rows(); track row.strike) {
            <div class="grid-cell row-header">
              <span class="strike-value">{{ row.strike }}</span>
              @if (atmDiff(row.strike) != null) {
                <span class="atm-diff">{{ formatAtmDiff(row.strike) }}</span>
              }
            </div>
            @for (cell of row.cells; track $index) {
              @if (cell) {
                <div
                  class="grid-cell data-cell"
                  [style.background-color]="cellColor(cell)"
                  [title]="cellTooltip(cell)"
                >
                  <span class="pct-change">{{ formatPct(cell.pctChange) }}</span>
                  <span class="price-detail">{{ formatPrice(cell.startPrice) }} → {{ formatPrice(cell.targetPrice) }}</span>
                  @if (cell.delta != null || cell.targetDelta != null) {
                    <span class="delta-detail">Δ{{ formatDelta(cell.delta) }} → Δ{{ formatDelta(cell.targetDelta) }}</span>
                  }
                  <button
                    type="button"
                    class="chart-icon-btn"
                    cdkOverlayOrigin
                    #cellIcon="cdkOverlayOrigin"
                    aria-label="Show contract price/delta chart"
                    (mouseenter)="onIconEnter(cell)"
                    (mouseleave)="onIconLeave($event)"
                    (click)="onIconClick($event, cell)"
                  >
                    <mat-icon>show_chart</mat-icon>
                  </button>
                  <ng-template
                    cdkConnectedOverlay
                    [cdkConnectedOverlayOrigin]="cellIcon"
                    [cdkConnectedOverlayOpen]="isSelected(cell)"
                    [cdkConnectedOverlayPositions]="overlayPositions"
                    [cdkConnectedOverlayScrollStrategy]="scrollStrategy"
                    [cdkConnectedOverlayPanelClass]="'contract-chart-pane'"
                  >
                    <app-contract-mini-chart
                      [contractID]="cell.contractID"
                      [strike]="cell.strike"
                      [expiration]="cell.expiration"
                      [type]="store.type()"
                      [series]="store.selectedContractSeries()"
                      (mouseenter)="onOverlayEnter()"
                      (mouseleave)="onOverlayLeave()"
                    />
                  </ng-template>
                </div>
              } @else {
                <div class="grid-cell empty-cell" title="No contract at this strike/expiration"></div>
              }
            }
          }
        </div>
      </div>
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

  /** Precomputed row matrix: one row per strike, cells ordered by expiration. */
  readonly rows = computed<GridRow[]>(() => {
    const g = this.grid();
    return g.strikes.map((strike) => ({
      strike,
      cells: g.expirations.map((exp) => g.cells.get(cellKey(strike, exp)) ?? null),
    }));
  });

  /** Underlying price pct change from start to target. */
  underlyingPctChange(): number | null {
    const g = this.grid();
    if (g.startUnderlyingPrice == null || g.targetUnderlyingPrice == null) return null;
    if (g.startUnderlyingPrice === 0) return null;
    return ((g.targetUnderlyingPrice - g.startUnderlyingPrice) / g.startUnderlyingPrice) * 100;
  }

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

  /** Whether this cell is the store's selected contract in this grid. */
  isSelected(cell: PctChangeCell): boolean {
    const sel = this.store.selectedCell();
    return (
      sel != null &&
      sel.contractID === cell.contractID &&
      sel.strike === cell.strike &&
      sel.expiration === cell.expiration &&
      sel.targetDate === this.grid().targetDate
    );
  }

  ngOnDestroy(): void {
    this.cancelPendingClear();
  }

  /** Icon hover — transient preview (store ignores it while pinned).
   *  Cancels any pending clear so a leave→enter sweep can't wipe the
   *  new selection when the delayed timer fires. */
  onIconEnter(cell: PctChangeCell): void {
    this.cancelPendingClear();
    this.store.previewContract(cell, this.grid().targetDate);
  }

  /** Icon leave — schedule a clear unless pinned or the pointer moved
   *  straight into this grid's chart pane. The grace delay covers the
   *  attach gap and the few px between icon and pane. */
  onIconLeave(event: MouseEvent): void {
    if (this.store.isContractPinned()) return;
    const to = event.relatedTarget as HTMLElement | null;
    if (to?.closest?.('.contract-chart-pane')) return;
    this.scheduleClear();
  }

  /** Icon click — pin the overlay open. Stops propagation so the page's
   *  document-click dismissal doesn't immediately close it. */
  onIconClick(event: MouseEvent, cell: PctChangeCell): void {
    event.stopPropagation();
    this.cancelPendingClear();
    this.store.pinContract(cell, this.grid().targetDate);
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

  /** Compute the background color for a cell. */
  cellColor(cell: PctChangeCell): string {
    const g = this.grid();
    return pctChangeToColor(cell.pctChange, g.p5, g.p95);
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
