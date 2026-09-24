/**
 * Columns picker — the "Columns" pill + dropdown listing every expiration
 * in the snapshot (checked = visible) plus DTE-band group checkboxes.
 * Owns only view state; `hidden` is two-way bound to the page's
 * persisted hiddenExpirations signal.
 */
import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';

import { daysBetween } from '../../../../shared/utils/date.util';
import { expirationMeta } from '../../../utils/option-grid.utils';

interface ExpBand {
  id: string;
  label: string;
  test: (dte: number) => boolean;
}

/** Precomputed band row — the template is render-only. */
interface BandRow {
  band: ExpBand;
  count: number;
  checked: boolean;
  indeterminate: boolean;
}

const EXP_BANDS: ExpBand[] = [
  { id: 'lt6', label: '<6d', test: (d) => d >= 0 && d < 6 },
  { id: 'd6_15', label: '6–15d', test: (d) => d >= 6 && d <= 15 },
  { id: 'd15_30', label: '15–30d', test: (d) => d > 15 && d <= 30 },
  { id: 'd30_60', label: '30–60d', test: (d) => d > 30 && d <= 60 },
  { id: 'd60_120', label: '60–120d', test: (d) => d > 60 && d <= 120 },
  { id: 'd120_365', label: '120–365d', test: (d) => d > 120 && d <= 365 },
  { id: 'gt365', label: '366d+', test: (d) => d > 365 },
];

@Component({
  selector: 'app-column-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="column-picker-wrap">
      <button
        type="button" class="filter-pill" data-testid="columns-picker"
        [class.active]="open() || hidden().size > 0"
        title="Show/hide expiration columns"
        (click)="open.set(!open())"
      >Columns{{ hidden().size ? ' (' + hidden().size + ' off)' : '' }}</button>
      @if (open()) {
        <div class="picker-backdrop" (click)="open.set(false)"></div>
        <div class="column-picker" role="dialog" aria-label="Expiration columns">
          <div class="picker-actions">
            <button type="button" data-testid="cols-all" (click)="setAll(true)">All</button>
            <button type="button" data-testid="cols-none" (click)="setAll(false)">None</button>
          </div>
          @for (b of bandRows(); track b.band.id) {
            <label class="picker-item picker-band">
              <input
                type="checkbox"
                [attr.data-band]="b.band.id"
                [checked]="b.checked"
                [indeterminate]="b.indeterminate"
                (change)="toggleBand(b.band, $event)"
              />
              <span class="picker-date picker-band-label">{{ b.band.label }}</span>
              <span class="picker-meta">{{ b.count }} exp</span>
            </label>
          }
          <div class="picker-divider"></div>
          @for (exp of exps(); track exp) {
            <label class="picker-item">
              <input
                type="checkbox"
                [checked]="!hidden().has(exp)"
                (change)="toggleExpiration(exp)"
              />
              <span class="picker-date">{{ exp }}</span>
              <span class="picker-meta">{{ expLabel(exp) }}</span>
            </label>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .column-picker-wrap { position: relative; }
    .picker-backdrop { position: fixed; inset: 0; z-index: 10; }
    .column-picker {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 11;
      min-width: 190px;
      max-height: 320px;
      overflow: auto;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      padding: 6px;
      font-size: 11px;
    }
    .picker-actions {
      display: flex;
      gap: 6px;
      padding: 2px 4px 6px;
      border-bottom: 1px solid #eee;
      margin-bottom: 4px;
    }
    .picker-actions button {
      border: 1px solid #ccc;
      border-radius: 4px;
      background: #f5f5f5;
      font-size: 10px;
      padding: 1px 8px;
      cursor: pointer;
    }
    .picker-actions button:hover { background: #eaeaea; }
    .picker-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 4px;
      cursor: pointer;
      white-space: nowrap;
      border-radius: 3px;
    }
    .picker-item:hover { background: #f2f5f8; }
    .picker-band-label { font-weight: 600; }
    .picker-divider { border-top: 1px solid #ddd; margin: 4px 0; }
    .picker-date { font-variant-numeric: tabular-nums; }
    .picker-meta { opacity: 0.55; font-size: 9.5px; margin-left: auto; }
  `],
})
export class ColumnPickerComponent {
  /** All expiration dates in the loaded snapshot, ascending. */
  readonly exps = input.required<string[]>();
  /** Session date — anchors DTE for bands and labels. */
  readonly session = input<string | null>(null);
  /** Two-way bound hidden-expiration set (the page persists it). */
  readonly hidden = model.required<ReadonlySet<string>>();

  readonly open = signal(false);
  readonly bands = EXP_BANDS;

  /** One view-model per non-empty band — checked = all in-band
   *  expirations visible, indeterminate = mixed. DTE-null expirations
   *  belong to no band. */
  readonly bandRows = computed<BandRow[]>(() => {
    const session = this.session();
    if (!session) return [];
    const hidden = this.hidden();
    const rows: BandRow[] = [];
    for (const band of EXP_BANDS) {
      const inBand = this.exps().filter((e) =>
        band.test(daysBetween(session, e)),
      );
      if (!inBand.length) continue;
      const visible = inBand.filter((e) => !hidden.has(e)).length;
      rows.push({
        band,
        count: inBand.length,
        checked: visible === inBand.length,
        indeterminate: visible > 0 && visible < inBand.length,
      });
    }
    return rows;
  });

  toggleExpiration(date: string): void {
    const next = new Set(this.hidden());
    if (next.has(date)) next.delete(date); else next.add(date);
    this.hidden.set(next);
  }

  setAll(visible: boolean): void {
    this.hidden.set(visible ? new Set() : new Set(this.exps()));
  }

  toggleBand(band: ExpBand, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const session = this.session();
    if (!session) return;
    const next = new Set(this.hidden());
    for (const e of this.exps()) {
      if (!band.test(daysBetween(session, e))) continue;
      if (checked) next.delete(e); else next.add(e);
    }
    this.hidden.set(next);
  }

  /** '2026-10-16' → 'Fri · 23d' — same convention as the column headers. */
  expLabel(date: string): string {
    const meta = expirationMeta(date, this.session());
    return meta.daysText != null ? `${meta.dowText} · ${meta.daysText}` : meta.dowText;
  }
}
