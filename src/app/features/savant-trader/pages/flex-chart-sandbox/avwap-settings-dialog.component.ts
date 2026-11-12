/**
 * AVWAP Settings Dialog — sandbox controls for ST Anchored VWAP, moved out of
 * the inline params strip (#1459) so the toolbar stays clean while more
 * visibility granularity is added. Opened via DsDialogService from the
 * sandbox toolbar; commits flow through the parent's onParam/paramOverrides
 * path, so edits apply live and persist exactly like the strip did.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { DS_DIALOG_DATA, DsDialogRef } from '../../../../shared/ds/ds-dialog';
import type { IndicatorParamDef } from '../../../shared/components/flex-chart/flex-chart.types';

export interface AvwapSettingsDialogData {
  /** Every editable AVWAP param — the `input: 'date'` historyStart param is
   *  rendered separately with its clear button, matching the old strip. */
  params: IndicatorParamDef[];
  /** The historyStart param def — date input + clear affordance. */
  historyParam: IndicatorParamDef;
  /** Live value accessor — merged declared defaults + sandbox overrides.
   *  A function (not a snapshot) so the dialog reflects external changes. */
  values: () => Record<string, number | string | boolean>;
  /** Commit seam — the same handler the strip used (paramOverrides → config). */
  onParam: (p: IndicatorParamDef, event: Event) => void;
  /** Clears the historyStart override back to "all of history". */
  onClearHistory: () => void;
}

interface GroupedParam {
  def: IndicatorParamDef;
  /** Display label with the group prefix stripped ('Line 1 High Color' →
   *  'High Color' inside the Line 1 group). */
  label: string;
}

interface ParamGroup {
  title: string;
  /** The group's per-line toggles (showLineNHigh/Low/ZigZag/Confirms →
   *  'Upper'/'Lower'/'Legs'/'Confirms', lineNPersist → 'Persist') —
   *  rendered on the header row, not in the grid. */
  shows: { def: IndicatorParamDef; label: string }[];
  /** Rows of params — related pairs (Left/Right Depth, High/Low Color) share
   *  a row; everything else gets its own row. */
  rows: GroupedParam[][];
  /** The shared section also hosts the historyStart row. */
  history?: boolean;
}

@Component({
  selector: 'app-avwap-settings-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h2 class="title">Anchored VWAP</h2>
    <div class="content" data-testid="avwap-settings-body">
      <div class="param-groups">
        @for (g of groups; track g.title) {
          <section class="param-group" [attr.data-testid]="'avwap-group-' + g.title.replace(' ', '')">
            <div class="group-head">
              <span class="group-title">{{ g.title }}</span>
              <span class="group-toggles">
                @for (s of g.shows; track s.def.key) {
                  <label class="show-row" [title]="s.def.label">
                    <input
                      class="param-check"
                      type="checkbox"
                      [attr.data-testid]="'avwap-' + s.def.key"
                      [checked]="data.values()[s.def.key]"
                      (change)="data.onParam(s.def, $event)"
                    />
                    <span>{{ s.label }}</span>
                  </label>
                }
              </span>
            </div>
            @for (row of g.rows; track $index) {
              <div class="param-grid">
                @for (item of row; track item.def.key) {
                  @if (item.def.input === 'radio') {
                    <!-- div, not label — a label-in-label would route every
                         click in the row to the first radio, pinning it to 1. -->
                    <div class="param-row" [title]="item.def.label">
                      <span class="param-label">{{ item.label }}</span>
                      <span class="radio-group" [attr.data-testid]="'avwap-' + item.def.key">
                        @for (v of radioValues(item.def); track v) {
                          <label class="radio-row">
                            <input
                              class="param-check"
                              type="radio"
                              [name]="item.def.key"
                              [attr.data-testid]="'avwap-' + item.def.key + '-' + v"
                              [value]="v"
                              [checked]="Number(data.values()[item.def.key]) === v"
                              (change)="data.onParam(item.def, $event)"
                            />
                            <span>{{ v }}</span>
                          </label>
                        }
                      </span>
                    </div>
                  } @else {
                    <label class="param-row" [title]="item.def.label">
                      <span class="param-label">{{ item.label }}</span>
                      @if (typeof item.def.default === 'boolean') {
                        <input
                          class="param-check"
                          type="checkbox"
                          [attr.data-testid]="'avwap-' + item.def.key"
                          [checked]="data.values()[item.def.key]"
                          (change)="data.onParam(item.def, $event)"
                        />
                      } @else {
                        <input
                          class="param-input"
                          [type]="item.def.input ?? 'text'"
                          [attr.data-testid]="'avwap-' + item.def.key"
                          [attr.min]="item.def.min ?? null"
                          [attr.max]="item.def.max ?? null"
                          [value]="data.values()[item.def.key]"
                          (change)="data.onParam(item.def, $event)"
                        />
                      }
                    </label>
                  }
                }
              </div>
            }
            @if (g.history) {
              <div class="param-grid">
                <label class="param-row history" [title]="data.historyParam.label">
                  <span class="param-label">{{ data.historyParam.label }}</span>
                  <span class="history-controls">
                    <input
                      class="param-input date"
                      type="date"
                      [attr.data-testid]="'avwap-' + data.historyParam.key"
                      [value]="data.values()[data.historyParam.key]"
                      (change)="data.onParam(data.historyParam, $event)"
                    />
                    <button
                      type="button"
                      class="history-clear"
                      data-testid="avwap-history-clear"
                      aria-label="Clear history start"
                      (click)="data.onClearHistory()"
                    >×</button>
                  </span>
                </label>
              </div>
            }
          </section>
        }
      </div>
    </div>
    <div class="actions">
      <button class="ds-btn fill" (click)="ref.close()" cdkFocusInitial>Done</button>
    </div>
  `,
  styles: [`
    .content {
      padding-top: 8px;
      max-height: 70vh;
      overflow-y: auto;
    }
    .param-groups {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .group-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 3px;
      margin-bottom: 6px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .group-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--mat-sys-on-surface-variant);
    }
    .group-toggles {
      display: inline-flex;
      align-items: center;
      gap: 12px;
    }
    .show-row {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      cursor: pointer;
    }
    .param-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 14px;
      margin-bottom: 6px;
    }
    .param-grid:last-child {
      margin-bottom: 0;
    }
    .param-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      font-size: 12px;
    }
    .param-label {
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--mat-sys-on-surface-variant);
    }
    .param-input {
      width: 68px;
      flex: none;
      height: 24px;
      padding: 0 6px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
      font-size: 12px;
    }
    .param-input[type='color'] {
      width: 44px;
      padding: 1px;
    }
    .param-input.date {
      width: 128px;
    }
    .param-check {
      flex: none;
      margin: 0;
    }
    .radio-group {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      flex: none;
    }
    .radio-row {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 12px;
      cursor: pointer;
    }
    .param-row.history {
      grid-column: 1 / -1;
    }
    .history-controls {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: none;
    }
    .history-clear {
      width: 22px;
      height: 22px;
      line-height: 20px;
      padding: 0;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvwapSettingsDialogComponent {
  readonly ref = inject(DsDialogRef<AvwapSettingsDialogComponent>);
  readonly data = inject(DS_DIALOG_DATA) as AvwapSettingsDialogData;

  /** Number coercible for template expressions ([checked] on radios). */
  readonly Number = Number;

  /** Integer options for an `input: 'radio'` def — min..max inclusive
   *  (line weight: 1, 2, 3). */
  radioValues(def: IndicatorParamDef): number[] {
    const out: number[] = [];
    for (let v = def.min ?? 0; v <= (def.max ?? 0); v++) out.push(v);
    return out;
  }

  /** Row layout inside a Line group — related pairs share a row: depths on
   *  one line, colors on the next. Suffixes not listed here get a row each,
   *  appended in declaration order. */
  private static readonly LINE_ROWS: string[][] = [
    ['RetracementPct', 'Weight'],
    ['LeftDepth', 'RightDepth'],
    ['HighColor', 'LowColor'],
  ];

  /** Split the flat param list into Line 1 / Line 2 / General groups. The
   *  per-line toggles move to the group header — showLineN{High,Low,ZigZag,
   *  Confirms} as 'Upper'/'Lower'/'Legs'/'Confirms' and lineN{Persist} as
   *  'Persist'; the 'Line N ' prefix is stripped from each row label so it
   *  isn't repeated per control. */
  get groups(): ParamGroup[] {
    const line1: GroupedParam[] = [];
    const line2: GroupedParam[] = [];
    const general: GroupedParam[] = [];
    const shows1: ParamGroup['shows'] = [];
    const shows2: ParamGroup['shows'] = [];
    const SHOW_LABELS: Record<string, string> = { High: 'Upper', Low: 'Lower', ZigZag: 'Legs', Confirms: 'Confirms', Persist: 'Persist' };

    for (const def of this.data.params) {
      if (def.key === this.data.historyParam.key) continue; // rendered separately, with its clear button
      const show = def.key.match(/^(?:showLine|line)([12])(High|Low|ZigZag|Confirms|Persist)$/);
      if (show) {
        (show[1] === '1' ? shows1 : shows2).push({ def, label: SHOW_LABELS[show[2]] });
        continue;
      }
      const m = def.key.match(/^line([12])(.*)$/);
      if (m) {
        const label = def.label.replace(/^Line [12]\s*/, '');
        (m[1] === '1' ? line1 : line2).push({ def, label });
      } else {
        general.push({ def, label: def.label });
      }
    }

    return [
      { title: 'Line 1', shows: shows1, rows: AvwapSettingsDialogComponent.lineRows(line1) },
      { title: 'Line 2', shows: shows2, rows: AvwapSettingsDialogComponent.lineRows(line2) },
      { title: 'General', shows: [], rows: AvwapSettingsDialogComponent.pairUp(general), history: true },
    ];
  }

  /** Order a line group's params into the declared row pairs; params whose
   *  key-suffix isn't in LINE_ROWS trail as single rows (future-proofing). */
  private static lineRows(params: GroupedParam[]): GroupedParam[][] {
    const placed = new Set<GroupedParam>();
    const rows = this.LINE_ROWS.map((suffixes) =>
      suffixes
        .map((suffix) => params.find((p) => p.def.key.endsWith(suffix)))
        .filter((p): p is GroupedParam => !!p)
        .map((p) => (placed.add(p), p)),
    ).filter((r) => r.length > 0);
    for (const p of params) {
      if (!placed.has(p)) rows.push([p]);
    }
    return rows;
  }

  /** General section: plain two-per-row packing in declaration order. */
  private static pairUp(params: GroupedParam[]): GroupedParam[][] {
    const rows: GroupedParam[][] = [];
    for (let i = 0; i < params.length; i += 2) rows.push(params.slice(i, i + 2));
    return rows;
  }
}
