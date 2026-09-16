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
  templateUrl: './pct-change-grid.component.html',
  styleUrl: './pct-change-grid.component.scss',
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
  formatAtmDiff(diff: number): string {
    const pct = this.atmPctDiff(this.grid().atmStrike! + diff);
    const sign = diff > 0 ? '+' : '';
    const pctStr = pct != null ? ` (${sign}${pct.toFixed(1)}%)` : '';
    return `${sign}${diff.toFixed(0)}${pctStr}`;
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
