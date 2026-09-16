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
import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';

import type { PctChangeGrid, PctChangeCell } from '../utils/pct-change.utils';
import { cellKey } from '../utils/pct-change.utils';
import { pctChangeToColor } from '../utils/color-mapping.utils';

/** A precomputed row: strike + ordered cells (null where no contract). */
interface GridRow {
  strike: number;
  cells: (PctChangeCell | null)[];
}

@Component({
  selector: 'app-pct-change-grid',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid-header">
      {{ grid().targetDate }} ({{ grid().durationDays }}d from start)
    </div>
    @if (grid().cells.size === 0) {
      <div class="no-data">No contracts matched the current filters.</div>
    } @else {
      <div class="grid-scroll">
        <div
          class="grid-body"
          [style.grid-template-columns]="'auto repeat(' + grid().expirations.length + ', minmax(80px, 1fr))'"
        >
          <!-- Header row: empty corner + expiration columns -->
          <div class="grid-cell header-cell"></div>
          @for (exp of grid().expirations; track exp) {
            <div class="grid-cell header-cell">{{ exp }}</div>
          }

          <!-- Body rows: one per strike -->
          @for (row of rows(); track row.strike) {
            <div class="grid-cell row-header">{{ row.strike }}</div>
            @for (cell of row.cells; track $index) {
              @if (cell) {
                <div
                  class="grid-cell data-cell"
                  [style.background-color]="cellColor(cell)"
                  [title]="cellTooltip(cell)"
                >
                  <span class="pct-change">{{ formatPct(cell.pctChange) }}</span>
                  <span class="price-detail">{{ formatPrice(cell.startPrice) }} → {{ formatPrice(cell.targetPrice) }}</span>
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
  styles: [`
    :host {
      display: block;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 1rem;
    }

    .grid-header {
      padding: 0.5rem 0.75rem;
      font-weight: 600;
      font-size: 0.875rem;
      background: #f5f5f5;
      border-bottom: 1px solid #e0e0e0;
    }

    .grid-scroll {
      overflow-x: auto;
    }

    .grid-body {
      display: grid;
      gap: 1px;
      background: #e0e0e0;
      min-width: max-content;
    }

    .grid-cell {
      padding: 0.4rem 0.5rem;
      font-size: 0.75rem;
      background: #fff;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 48px;
    }

    .header-cell {
      font-weight: 600;
      background: #f5f5f5;
      text-align: center;
    }

    .row-header {
      font-weight: 600;
      background: #f5f5f5;
      text-align: right;
      justify-content: center;
      align-items: flex-end;
      padding-right: 0.6rem;
    }

    .data-cell {
      cursor: default;
      transition: opacity 0.15s;
    }

    .data-cell:hover {
      opacity: 0.85;
    }

    .empty-cell {
      background: #fafafa;
    }

    .pct-change {
      font-weight: 700;
      font-size: 0.85rem;
    }

    .price-detail {
      font-size: 0.65rem;
      opacity: 0.8;
      margin-top: 2px;
    }

    .no-data {
      padding: 1.5rem;
      text-align: center;
      color: #999;
      font-size: 0.85rem;
    }
  `],
})
export class PctChangeGridComponent {
  /** The grid to render. */
  readonly grid = input.required<PctChangeGrid>();

  /** Precomputed row matrix: one row per strike, cells ordered by expiration. */
  readonly rows = computed<GridRow[]>(() => {
    const g = this.grid();
    return g.strikes.map((strike) => ({
      strike,
      cells: g.expirations.map((exp) => g.cells.get(cellKey(strike, exp)) ?? null),
    }));
  });

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
