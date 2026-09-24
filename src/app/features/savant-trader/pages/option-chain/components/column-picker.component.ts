/**
 * Columns picker — the "Columns" pill + dropdown listing every expiration
 * in the snapshot (checked = visible) plus DTE-band group checkboxes.
 *
 * Selection model: band checkboxes persist BAND IDs (deselected DTE
 * windows), not resolved dates — so when the session date changes and
 * expirations land in different bands, hidden columns re-derive from the
 * same band choices. Per-expiration checkboxes write minimal overrides
 * (expHidden / expShown) that beat the band default for that date.
 *
 * Owns only view state; the three models are two-way bound to the page's
 * persisted signals.
 */
import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';

import {
  dteBandId,
  effectiveHiddenExpirations,
  EXP_BANDS,
  type ExpBand,
} from '../utils/column-visibility.utils';
import { expirationMeta } from '../../../utils/option-grid.utils';

/** Precomputed band row — the template is render-only. */
interface BandRow {
  band: ExpBand;
  count: number;
  checked: boolean;
  indeterminate: boolean;
}

@Component({
  selector: 'app-column-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="column-picker-wrap">
      <button
        type="button" class="filter-pill" data-testid="columns-picker"
        [class.active]="open() || effectiveHidden().size > 0"
        title="Show/hide expiration columns"
        (click)="open.set(!open())"
      >Columns{{ effectiveHidden().size ? ' (' + effectiveHidden().size + ' off)' : '' }}</button>
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
                [checked]="!effectiveHidden().has(exp)"
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
      background: var(--mat-sys-surface, #fff);
      border: 1px solid var(--mat-sys-outline-variant, #ccc);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      padding: 6px;
      font-size: 11px;
    }
    .picker-actions {
      display: flex;
      gap: 6px;
      padding: 2px 4px 6px;
      border-bottom: 1px solid var(--mat-sys-outline-variant, #eee);
      margin-bottom: 4px;
    }
    .picker-actions button {
      border: 1px solid var(--mat-sys-outline-variant, #ccc);
      border-radius: 4px;
      background: var(--mat-sys-surface-container-high, #f5f5f5);
      font-size: 10px;
      padding: 1px 8px;
      cursor: pointer;
    }
    .picker-actions button:hover { background: var(--mat-sys-surface-container-highest, #eaeaea); }
    .picker-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 4px;
      cursor: pointer;
      white-space: nowrap;
      border-radius: 3px;
    }
    .picker-item:hover { background: var(--mat-sys-surface-container-high, #f2f5f8); }
    .picker-band-label { font-weight: 600; }
    .picker-divider { border-top: 1px solid var(--mat-sys-outline-variant, #ddd); margin: 4px 0; }
    .picker-date { font-variant-numeric: tabular-nums; }
    .picker-meta { opacity: 0.55; font-size: 9.5px; margin-left: auto; }
  `],
})
export class ColumnPickerComponent {
  /** All expiration dates in the loaded snapshot, ascending. */
  readonly exps = input.required<string[]>();
  /** Session date — anchors DTE for bands and labels. */
  readonly session = input<string | null>(null);
  /** Deselected DTE bands — persist as band ids so they re-derive when
   *  the session date shifts expirations across band boundaries. */
  readonly hiddenBands = model.required<ReadonlySet<string>>();
  /** Explicitly hidden expirations — override a visible band. */
  readonly expHidden = model.required<ReadonlySet<string>>();
  /** Explicitly shown expirations — override a hidden band. */
  readonly expShown = model.required<ReadonlySet<string>>();

  readonly open = signal(false);

  /** Effective hidden set for the current session — the single place
   *  bands and overrides combine; the page applies the same formula via
   *  effectiveHiddenExpirations() when filtering grid columns. */
  readonly effectiveHidden = computed(() =>
    effectiveHiddenExpirations(
      this.exps(),
      this.session(),
      this.hiddenBands(),
      this.expHidden(),
      this.expShown(),
    ),
  );

  /** One view-model per non-empty band — checked = band not deselected,
   *  indeterminate = mixed effective visibility inside the band. */
  readonly bandRows = computed<BandRow[]>(() => {
    const session = this.session();
    if (!session) return [];
    const hiddenBands = this.hiddenBands();
    const effective = this.effectiveHidden();
    const rows: BandRow[] = [];
    for (const band of EXP_BANDS) {
      const inBand = this.exps().filter(
        (e) => dteBandId(session, e) === band.id,
      );
      if (!inBand.length) continue;
      const visible = inBand.filter((e) => !effective.has(e)).length;
      rows.push({
        band,
        count: inBand.length,
        checked: !hiddenBands.has(band.id),
        indeterminate: visible > 0 && visible < inBand.length,
      });
    }
    return rows;
  });

  /** Per-expiration checkbox — writes the minimal override: entries
   *  matching the band default are removed so overrides stay sparse. */
  toggleExpiration(exp: string): void {
    const bandHidden = this.hiddenBands().has(dteBandId(this.session(), exp) ?? '');
    const nextHidden = !this.effectiveHidden().has(exp);
    const hidden = new Set(this.expHidden());
    const shown = new Set(this.expShown());
    if (nextHidden === bandHidden) {
      hidden.delete(exp);
      shown.delete(exp);
    } else if (nextHidden) {
      shown.delete(exp);
      hidden.add(exp);
    } else {
      hidden.delete(exp);
      shown.add(exp);
    }
    this.expHidden.set(hidden);
    this.expShown.set(shown);
  }

  /** Band checkbox — toggles the band id; member overrides are kept
   *  (the row goes indeterminate to show the mix). */
  toggleBand(band: ExpBand, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.hiddenBands());
    if (checked) next.delete(band.id); else next.add(band.id);
    this.hiddenBands.set(next);
  }

  setAll(visible: boolean): void {
    if (visible) {
      this.hiddenBands.set(new Set());
      this.expHidden.set(new Set());
      this.expShown.set(new Set());
    } else {
      // Band ids persist across session changes — "hide everything"
      // means every band, plus explicit hides for band-less expirations.
      this.hiddenBands.set(new Set(EXP_BANDS.map((b) => b.id)));
      this.expShown.set(new Set());
      this.expHidden.set(
        new Set(
          this.exps().filter((e) => dteBandId(this.session(), e) === null),
        ),
      );
    }
  }

  /** '2026-10-16' → 'Fri · 23d' — same convention as the column headers. */
  expLabel(date: string): string {
    const meta = expirationMeta(date, this.session());
    return meta.daysText != null ? `${meta.dowText} · ${meta.daysText}` : meta.dowText;
  }
}
