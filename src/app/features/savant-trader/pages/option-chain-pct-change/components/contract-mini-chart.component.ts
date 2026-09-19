/**
 * ContractMiniChartComponent — lightweight inline-SVG sparkline showing a
 * contract's price and delta across the loaded snapshot dates. Pure
 * presentational: all data arrives via inputs, no store injection.
 *
 * Price (primary color, left axis) and delta (secondary color, right axis)
 * are drawn on independent data-driven scales so both stay legible across
 * their very different numeric ranges. Ticks show actual min/mid/max
 * values — the requirement is real numbers, not unscaled lines.
 *
 * Delta gaps: points with a null delta are skipped and the delta polyline
 * is split into contiguous runs — the line never bridges a gap, so no
 * implied interpolation is drawn.
 */
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { OptionType } from '@options-contract/contracts';
import type { ContractSeriesPoint } from '../utils/pct-change.utils';

const W = 240;
const H = 104;
const PAD_X = 34;
const PAD_TOP = 8;
const PLOT_H = 62;
const PLOT_W = W - PAD_X * 2;

function fmt(v: number): string {
  return v.toFixed(2);
}

/** Scale series values to SVG y coordinates (top = max, bottom = min). */
function yScale(values: number[]): (v: number) => number {
  const finite = values.filter(Number.isFinite);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  if (span === 0 || !Number.isFinite(span)) return () => PAD_TOP + PLOT_H / 2;
  return (v) => PAD_TOP + (1 - (v - min) / span) * PLOT_H;
}

/** X position of the i-th point, evenly spaced across the plot width. */
function xAt(i: number, n: number): number {
  if (n <= 1) return PAD_X + PLOT_W / 2;
  return PAD_X + (i / (n - 1)) * PLOT_W;
}

interface Vertex {
  x: number;
  y: number;
  value: number;
}

interface Tick {
  y: number;
  label: string;
}

/** Min/mid/max ticks for a vertex set, deduped by formatted label so a
 *  flat range doesn't stack three identical texts at the same y. */
function makeTicks(verts: Vertex[], scale: (v: number) => number): Tick[] {
  if (!verts.length) return [];
  const vals = verts.map((v) => v.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const mid = (min + max) / 2;
  const out: Tick[] = [];
  const seen = new Set<string>();
  for (const v of [max, mid, min]) {
    const label = fmt(v);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ y: scale(v), label });
  }
  return out;
}

/** Value annotation for every vertex — {x, y, label}. */
function pointAnnots(verts: Vertex[]): { x: number; y: number; label: string }[] {
  return verts.map((v) => ({ x: v.x, y: v.y, label: fmt(v.value) }));
}

@Component({
  selector: 'app-contract-mini-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mini-chart">
      <div class="chart-header">
        <span class="type-badge" [class.put]="type() === OptionType.PUT">{{ typeLabel() }}</span>
        <span class="contract-id">{{ contractID() }}</span>
        <span class="contract-detail">\${{ strike() }} · {{ expiration() }}</span>
        <span class="chart-legend">
          <span class="legend-item"><span class="swatch price-swatch"></span>Price</span>
          <span class="legend-item"><span class="swatch delta-swatch"></span>Delta</span>
        </span>
      </div>

      @if (series().length === 0) {
        <div class="chart-empty">No data for this contract</div>
      } @else {
        <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" class="chart-svg" role="img" [attr.aria-label]="'Price and delta chart for ' + contractID()">
          <!-- Price axis ticks (left) -->
          @for (t of priceTicks(); track $index) {
            <text class="price-tick axis-tick" x="2" [attr.y]="t.y + 3">{{ t.label }}</text>
            <line class="tick-guide" [attr.x1]="PAD_X" [attr.y1]="t.y" [attr.x2]="PAD_X + PLOT_W" [attr.y2]="t.y" />
          }
          <!-- Delta axis ticks (right) -->
          @for (t of deltaTicks(); track $index) {
            <text class="delta-tick axis-tick" [attr.x]="W - 32" [attr.y]="t.y + 3">{{ t.label }}</text>
          }

          <!-- Price series -->
          @if (priceVerts().length > 1) {
            <polyline class="price-line" fill="none" [attr.points]="pricePoints()" />
          }
          @for (v of priceVerts(); track $index) {
            <circle class="price-dot" [attr.cx]="v.x" [attr.cy]="v.y" r="2" />
          }

          <!-- Delta series — contiguous runs; the line never bridges a null-delta gap -->
          @for (run of deltaRuns(); track $index) {
            <polyline class="delta-line" fill="none" stroke-dasharray="3 2" [attr.points]="run" />
          }
          @for (v of deltaVerts(); track $index) {
            <circle class="delta-dot" [attr.cx]="v.x" [attr.cy]="v.y" r="1.5" />
          }

          <!-- Value annotations on every data point (price above, delta below) -->
          @for (a of priceAnnots(); track $index) {
            <text class="value-annotation price-annot" [attr.x]="a.x" [attr.y]="a.y - 4" text-anchor="middle">{{ a.label }}</text>
          }
          @for (a of deltaAnnots(); track $index) {
            <text class="value-annotation delta-annot" [attr.x]="a.x" [attr.y]="a.y + 9" text-anchor="middle">{{ a.label }}</text>
          }
        </svg>

        <div class="chart-dates">
          <span>{{ series()[0].date }}</span>
          <span>{{ series()[series().length - 1].date }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      --price-color: #1976d2;
      --delta-color: #e65100;
    }
    .mini-chart {
      width: 240px; background: var(--mat-sys-surface, #fff);
      border: 1px solid var(--mat-sys-outline-variant, #ddd);
      border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.12);
      padding: 6px 8px; font-size: 10px;
      color: var(--mat-sys-on-surface, #222);
    }
    .chart-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; flex-wrap: wrap; }
    .type-badge {
      font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px;
      background: var(--mat-sys-primary, var(--price-color)); color: #fff;
    }
    .type-badge.put { background: var(--mat-sys-error, #c62828); }
    .contract-id { font-weight: 600; font-size: 10px; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .contract-detail { color: var(--mat-sys-on-surface-variant, #666); }
    .chart-legend { margin-left: auto; display: flex; gap: 8px; }
    .legend-item { display: inline-flex; align-items: center; gap: 3px; font-size: 9px; color: var(--mat-sys-on-surface-variant, #666); }
    .swatch { width: 10px; height: 2px; display: inline-block; }
    .price-swatch { background: var(--price-color); }
    .delta-swatch { background: var(--delta-color); }
    .chart-svg { display: block; width: 100%; height: auto; }
    .axis-tick { font-size: 7px; fill: var(--mat-sys-on-surface-variant, #888); }
    .tick-guide { stroke: var(--mat-sys-outline-variant, #eee); stroke-width: 0.5; }
    .price-line { stroke: var(--price-color); stroke-width: 1.5; }
    .delta-line { stroke: var(--delta-color); stroke-width: 1; }
    .price-dot { fill: var(--price-color); }
    .delta-dot { fill: var(--delta-color); }
    .value-annotation { font-size: 7px; font-weight: 600; }
    .price-annot { fill: var(--price-color); }
    .delta-annot { fill: var(--delta-color); }
    .chart-dates { display: flex; justify-content: space-between; font-size: 8px; color: var(--mat-sys-on-surface-variant, #888); padding: 0 34px; }
    .chart-empty { padding: 20px 0; text-align: center; color: var(--mat-sys-on-surface-variant, #888); font-size: 11px; }
  `],
})
export class ContractMiniChartComponent {
  readonly contractID = input.required<string>();
  readonly strike = input.required<number>();
  readonly expiration = input.required<string>();
  readonly type = input.required<OptionType>();
  readonly series = input.required<ContractSeriesPoint[]>();

  readonly OptionType = OptionType;
  readonly typeLabel = computed(() => this.type().toUpperCase());
  readonly W = W;
  readonly H = H;
  readonly PAD_X = PAD_X;
  readonly PLOT_W = PLOT_W;

  private readonly priceYScale = computed(() => yScale(this.series().map((p) => p.price)));
  private readonly deltaYScale = computed(() =>
    yScale(this.series().map((p) => p.delta).filter((d): d is number => d != null)),
  );

  readonly priceVerts = computed<Vertex[]>(() =>
    this.series()
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => Number.isFinite(p.price))
      .map(({ p, i }) => ({ x: xAt(i, this.series().length), y: this.priceYScale()(p.price), value: p.price })),
  );

  readonly deltaVerts = computed<Vertex[]>(() =>
    this.series()
      .map((p, i) => ({ d: p.delta, i }))
      .filter((v): v is { d: number; i: number } => v.d != null && Number.isFinite(v.d))
      .map(({ d, i }) => ({ x: xAt(i, this.series().length), y: this.deltaYScale()(d), value: d })),
  );

  readonly pricePoints = computed(() => this.priceVerts().map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' '));

  /** Delta polyline split at null-delta points — each run is one points string. */
  readonly deltaRuns = computed<string[]>(() => {
    const runs: string[] = [];
    let cur: string[] = [];
    this.series().forEach((p, i) => {
      if (p.delta != null && Number.isFinite(p.delta)) {
        cur.push(`${xAt(i, this.series().length).toFixed(1)},${this.deltaYScale()(p.delta).toFixed(1)}`);
      } else {
        if (cur.length > 1) runs.push(cur.join(' '));
        cur = [];
      }
    });
    if (cur.length > 1) runs.push(cur.join(' '));
    return runs;
  });

  readonly priceTicks = computed(() => makeTicks(this.priceVerts(), this.priceYScale()));
  readonly deltaTicks = computed(() => makeTicks(this.deltaVerts(), this.deltaYScale()));

  readonly priceAnnots = computed(() => pointAnnots(this.priceVerts()));
  readonly deltaAnnots = computed(() => pointAnnots(this.deltaVerts()));
}
