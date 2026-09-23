/**
 * Chain Grid Component
 *
 * Renders one side's (calls or puts) strikes x expirations matrix from a
 * precomputed ChainGridModel. Cells show mark, chg $/chg % vs the prior
 * session, delta, and IV — all strings precomputed by chain.utils.
 *
 * Perf contract mirrors pct-change-grid: delegated mouseover/mouseout on
 * the grid body (no per-cell components or listeners) and OnPush. Hover
 * events carry the cell element so one overlay per grid can anchor to it
 * (popup lands in a later task).
 */
import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, input, output } from '@angular/core';

import type { ChainCell, ChainGridModel } from '../utils/chain.utils';
import { OptionType } from '@options-contract/contracts';
import { DAYS, daysBetween } from '../../../../shared/utils/date.util';
import { formatAtmDiff } from '../../../utils/option-grid.utils';

/** A precomputed expiration column header. */
interface ExpHeader {
  date: string;
  /** 3-letter day of week, e.g. 'Fri'. */
  dowText: string;
  /** Days from the session date to expiration — null when no session date. */
  daysText: string | null;
}

export interface ChainCellHover {
  cell: ChainCell;
  /** The hovered cell element — overlay anchor. */
  target: HTMLElement;
}

@Component({
  selector: 'app-chain-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chain-grid" [attr.data-side]="side()">
      @if (model().rows.length === 0) {
        <div class="no-data">No contracts matched the current filters.</div>
      } @else {
        <div class="grid-scroll">
          <div
            class="grid-body"
            [style.grid-template-columns]="'auto repeat(' + expHeaders().length + ', minmax(50px, 1fr))'"
            (mouseover)="onCellOver($event)"
            (mouseout)="onCellOut($event)"
          >
            <div class="grid-cell header-cell corner-cell"></div>
            @for (exp of expHeaders(); track exp.date) {
              <div class="grid-cell header-cell">
                <span class="exp-date">{{ exp.date }} {{ exp.dowText }}</span>
                @if (exp.daysText != null) {
                  <span class="exp-days">{{ exp.daysText }}</span>
                }
              </div>
            }
            @for (row of viewRows(); track row.strike) {
              <div
                class="grid-cell row-header"
                [attr.data-strike]="row.strike"
                [class.atm]="row.strike === model().atmStrike"
              >
                <span class="strike-value">{{ row.strike }}</span>
                @if (row.atmText != null) {
                  <span class="atm-diff">{{ row.atmText }}</span>
                }
              </div>
              @for (cell of row.cells; track $index) {
                @if (cell) {
                  <div
                    class="grid-cell data-cell"
                    [attr.data-cid]="cell.contractID"
                    [class.atm]="row.strike === model().atmStrike"
                    [class.chg-pos]="cell.chgAbs !== null && cell.chgAbs > 0"
                    [class.chg-neg]="cell.chgAbs !== null && cell.chgAbs < 0"
                  >
                    <span class="cell-mark">{{ cell.markText }}</span>
                    <span class="cell-chg">{{ cell.chgText }}</span>
                    <span class="cell-greeks">{{ cell.deltaText }} · {{ cell.ivText }}</span>
                  </div>
                } @else {
                  <div class="grid-cell empty-cell" [class.atm]="row.strike === model().atmStrike"></div>
                }
              }
            }
          </div>
        </div>
      }
    </div>
  `,
  // Cell density/fonts mirror pct-change-grid.component (1px padding,
  // 0.55rem base, minmax(50px,1fr) columns). No heatmap coloring yet —
  // that's a later task.
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
      background: #fff;
    }
    .chain-grid {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .grid-scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }
    .grid-body {
      display: grid;
      gap: 1px;
      background: #e0e0e0;
      font-size: 0.55rem;
      min-width: max-content;
    }
    .grid-cell {
      padding: 1px 3px;
      background: #fff;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 14px;
      line-height: 1.1;
      min-width: 0;
    }
    .header-cell {
      background: #f5f5f5;
      font-weight: 600;
      position: sticky;
      top: 0;
      z-index: 2;
      gap: 0;
      white-space: nowrap;
    }
    .exp-date {
      font-size: 0.55rem;
    }
    .exp-days {
      font-size: 0.45rem;
      font-weight: 400;
      opacity: 0.7;
    }
    .corner-cell {
      left: 0;
      z-index: 3;
    }
    .row-header {
      background: #f5f5f5;
      font-weight: 600;
      align-items: flex-end;
      padding-right: 3px;
      position: sticky;
      left: 0;
      z-index: 1;
      gap: 0;
      font-variant-numeric: tabular-nums;
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
    }
    .data-cell:hover { opacity: 0.85; }
    .row-header.atm { color: #1565c0; }
    .data-cell.atm, .empty-cell.atm { background: #eef4fb; }
    .cell-mark { font-weight: 700; font-size: 0.6rem; }
    .cell-chg { font-size: 0.45rem; opacity: 0.8; }
    .chg-pos .cell-chg { color: #0a7c2e; }
    .chg-neg .cell-chg { color: #b00; }
    .cell-greeks { font-size: 0.4rem; opacity: 0.6; }
    .empty-cell { background: #fafafa; }
    .no-data {
      padding: 1rem;
      text-align: center;
      color: #999;
      font-size: 0.8rem;
    }
  `],
})
export class ChainGridComponent {
  readonly model = input.required<ChainGridModel>();
  readonly side = input<OptionType>(OptionType.CALL);
  /** Session date the snapshot belongs to — drives the DTE sub-label in
   *  expiration headers. Null hides the label. */
  readonly sessionDate = input<string | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // The chain is a sparse cross-product — strikes descending puts the
    // far-OTM rows (mostly holes) on top. Center the ATM row once per
    // distinct model identity (new session / new strike set / orientation
    // flip) — NOT on every rebuild, or the prior-session fetch landing
    // after the session one would yank a user's scroll position.
    afterRenderEffect(() => {
      const m = this.model();
      const session = this.sessionDate();
      if (m.atmStrike == null) {
        this.lastScrolledKey = null;
        return;
      }
      const key = `${session}|${m.atmStrike}|${m.rows[0]?.strike}|${m.rows.length}`;
      if (key === this.lastScrolledKey) return;
      this.lastScrolledKey = key;
      const row = this.host.nativeElement.querySelector<HTMLElement>(
        `[data-strike="${m.atmStrike}"]`,
      );
      row?.scrollIntoView?.({ block: 'center' });
    });
  }

  private lastScrolledKey: string | null = null;

  /** Fires when the pointer enters a data cell (delegated). */
  readonly cellEnter = output<ChainCellHover>();
  /** Fires when the pointer leaves a data cell (delegated). */
  readonly cellLeave = output<void>();

  /** Precomputed expiration headers — date + day-of-week + DTE resolved once. */
  readonly expHeaders = computed<ExpHeader[]>(() => {
    const session = this.sessionDate();
    return this.model().expirations.map((date) => ({
      date,
      dowText: DAYS[new Date(date + 'T00:00:00Z').getUTCDay()],
      daysText: session ? `${daysBetween(session, date)}d` : null,
    }));
  });

  /** Rows plus the "±N (±X%)" ATM-diff sub-label (same as pct-change's). */
  readonly viewRows = computed(() => {
    const m = this.model();
    const atm = m.atmStrike;
    return m.rows.map((row) => ({
      ...row,
      atmText: formatAtmDiff(row.strike, atm),
    }));
  });

  private readonly cellById = computed(() => {
    const map = new Map<string, ChainCell>();
    for (const row of this.model().rows) {
      for (const cell of row.cells) {
        if (cell) map.set(cell.contractID, cell);
      }
    }
    return map;
  });

  onCellOver(event: MouseEvent): void {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-cid]');
    if (!el?.dataset['cid']) return;
    // Ignore intra-cell moves (mark → chg span) — same suppression as onCellOut,
    // so a single cell visit emits exactly one enter / one leave pair.
    const from = event.relatedTarget as HTMLElement | null;
    if (from && el.contains(from)) return;
    const cell = this.cellById().get(el.dataset['cid']);
    if (cell) this.cellEnter.emit({ cell, target: el });
  }

  onCellOut(event: MouseEvent): void {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-cid]');
    if (!el) return;
    const to = event.relatedTarget as HTMLElement | null;
    // Ignore intra-cell moves (mark → chg span) — only fire on real exits.
    if (!to || !el.contains(to)) this.cellLeave.emit();
  }
}
