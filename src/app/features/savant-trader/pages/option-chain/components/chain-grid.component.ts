/**
 * Chain Grid Component
 *
 * Renders one side's (calls or puts) strikes x expirations matrix from a
 * precomputed ChainGridModel. Cells show mark, chg $/chg % vs the prior
 * session, delta, and IV — all strings precomputed by chain.utils.
 *
 * Perf contract mirrors pct-change-grid: delegated mouseover/mouseout on
 * the grid body (no per-cell components or listeners) and OnPush. The
 * delegated-hover mechanics are shared via DelegatedCellHover — hovering
 * a cell reveals a corner icon; hovering the icon opens the contract
 * popup anchored to the cell element.
 */
import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, effect, inject, input, signal } from '@angular/core';
import { Overlay, OverlayModule, type ConnectedPosition } from '@angular/cdk/overlay';
import { MatIconModule } from '@angular/material/icon';

import type { ChainCell, ChainGridModel } from '../utils/chain.utils';
import { OptionType } from '@options-contract/contracts';
import { expirationMeta, formatAtmDiff, MIN_CELL_PRICE, percentile } from '../../../utils/option-grid.utils';
import { pctChangeToCellColors } from '../../../utils/color-mapping.utils';
import { DelegatedCellHover } from '../../../utils/delegated-cell-hover';
import { ChainCellPopupComponent } from './chain-cell-popup.component';

/** A precomputed expiration column header. */
interface ExpHeader {
  date: string;
  /** 3-letter day of week, e.g. 'Fri'. */
  dowText: string;
  /** Days from the session date to expiration — null when no session date. */
  daysText: string | null;
  /** First column of a new calendar month — gets a separator border. */
  isMonthStart: boolean;
  /** Alternates 0/1 per month block — subtle column tint for time grouping. */
  monthParity: 0 | 1;
}

/** Per-cell view style — gradient colors + top-gainer flag. */
interface CellView {
  bg: string | null;
  fg: string | null;
  shadow: string | null;
  isTop: boolean;
}

@Component({
  selector: 'app-chain-grid',
  standalone: true,
  imports: [OverlayModule, MatIconModule, ChainCellPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chain-grid.component.html',
  styleUrl: './chain-grid.component.scss',
})
export class ChainGridComponent {
  readonly model = input.required<ChainGridModel>();
  readonly side = input<OptionType>(OptionType.CALL);
  /** Session date the snapshot belongs to — drives the DTE sub-label in
   *  expiration headers. Null hides the label. */
  readonly sessionDate = input<string | null>(null);
  /** Toggle for the |delta| band shading (odd tenths shaded). */
  readonly deltaShading = input<boolean>(true);
  /** Toggle for the month-boundary separators + alternating-month tint. */
  readonly timeShading = input<boolean>(true);
  /** Toggle for the chg gradient + top-5 gainer rings (one layer). */
  readonly heatmap = input<boolean>(true);
  /** Direction of the per-column top-5 ring — 'gainers' = largest positive
   *  chgPct, 'losers' = most negative, null = no rings (flat/missing
   *  underlying closes make the ring meaningless). */
  readonly topDirection = input<'gainers' | 'losers' | null>('gainers');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly overlay = inject(Overlay);

  /** Popup repositions with its anchor cell when the pane scrolls —
   *  same strategy pct-change uses; noop (the default) leaves the popup
   *  floating over unrelated cells. */
  readonly scrollStrategy = this.overlay.scrollStrategies.reposition();

  private readonly cellById = computed(() => {
    const map = new Map<string, ChainCell>();
    for (const row of this.model().rows) {
      for (const cell of row.cells) {
        if (cell) map.set(cell.contractID, cell);
      }
    }
    return map;
  });

  /** The cell whose popup is open + the element it's anchored to. The
   *  anchor is the CELL element, not the icon, so the overlay survives the
   *  icon's teardown when the pointer moves between cells. */
  readonly hoverCell = signal<ChainCell | null>(null);
  readonly hoverOrigin = signal<HTMLElement | null>(null);

  /** Shared delegated-hover mechanics (icon reveal, intra-cell
   *  suppression, icon enter/leave) — see DelegatedCellHover. */
  private readonly hover = new DelegatedCellHover<ChainCell>({
    cellIdAttr: 'data-cid',
    iconSelector: '.popup-icon-btn',
    cellFor: (id) => this.cellById().get(id) ?? null,
    onIconEnter: (cell, el) => {
      this.hoverCell.set(cell);
      this.hoverOrigin.set(el);
    },
    onIconLeave: () => {
      this.hoverCell.set(null);
      this.hoverOrigin.set(null);
    },
  });

  /** contractID of the cell currently showing the popup icon — alias of
   *  the shared controller's signal so the template stays terse. */
  readonly iconCellId = this.hover.iconCellId;

  // A model rebuild destroys the rendered cells — drop the hover anchor
  // AND the icon id so neither can bind to a dead element.
  private readonly clearHoverOnModel = effect(() => {
    this.model();
    this.hoverCell.set(null);
    this.hoverOrigin.set(null);
    this.hover.reset();
  });

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

  /** Scroll the ATM strike row to the middle of the viewport — the page's
   *  re-sync button calls this on both panes. */
  centerAtm(): void {
    const atm = this.model().atmStrike;
    if (atm == null) return;
    this.host.nativeElement
      .querySelector<HTMLElement>(`[data-strike="${atm}"]`)
      ?.scrollIntoView?.({ block: 'center' });
  }

  /** Right of the cell, then left, then below, then above — first fit
   *  wins; the above fallback keeps the popup off-clamped for bottom rows. */
  readonly popupPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 6 },
    { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -6 },
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 6 },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -6 },
  ];

  onCellOver(event: MouseEvent): void {
    this.hover.over(event);
  }

  onCellOut(event: MouseEvent): void {
    this.hover.out(event);
  }

  /** Cell click reveals the icon (touch); icon click opens the popup. */
  onCellClick(event: MouseEvent): void {
    this.hover.click(event);
  }

  /** The icon is a real button — once revealed, Tab reaches it and
   *  focusin opens the popup like hover; focusout closes it. */
  onFocusIn(event: FocusEvent): void {
    this.hover.focusIn(event);
  }

  onFocusOut(event: FocusEvent): void {
    this.hover.focusOut(event);
  }

  /** Precomputed expiration headers — date + day-of-week + DTE resolved
   *  once, plus month-boundary markers for the time-axis separators. */
  readonly expHeaders = computed<ExpHeader[]>(() => {
    const session = this.sessionDate();
    let prevMonth = '';
    let parity: 0 | 1 = 0;
    return this.model().expirations.map((date) => {
      const month = date.slice(0, 7);
      const isMonthStart = month !== prevMonth;
      if (isMonthStart) {
        parity = parity === 0 ? 1 : 0;
        prevMonth = month;
      }
      return { date, ...expirationMeta(date, session), isMonthStart, monthParity: parity };
    });
  });

  /** Per-cell gradient colors + top-5-per-expiration gainer flags — same
   *  scale and penny exclusion as the pct-change grid (chgPct vs prior
   *  session is our lookback). Cells without a change render flat. */
  readonly cellViews = computed(() => {
    const m = this.model();
    const cells: ChainCell[] = [];
    for (const row of m.rows) {
      for (const c of row.cells) if (c) cells.push(c);
    }
    // Penny-priced cells wreck the pct scale — excluded from the percentile
    // range AND the top-5, same as pct-change's MIN_CELL_PRICE rule.
    const scaleCells = cells.filter(
      (c): c is ChainCell & { chgPct: number } =>
        c.chgPct !== null &&
        c.mark !== null && c.mark >= MIN_CELL_PRICE &&
        c.priorMark !== null && c.priorMark >= MIN_CELL_PRICE,
    );
    const sorted = scaleCells.map((c) => c.chgPct * 100).sort((a, b) => a - b);
    const p5 = percentile(sorted, 5);
    const p95 = percentile(sorted, 95);

    const losers = this.topDirection() === 'losers';
    const top = new Set<string>();
    if (this.topDirection() !== null) {
      for (const exp of m.expirations) {
        scaleCells
          .filter((c) =>
            c.expiration === exp && (losers ? c.chgPct < 0 : c.chgPct > 0),
          )
          .sort((a, b) => (losers ? a.chgPct - b.chgPct : b.chgPct - a.chgPct))
          .slice(0, 5)
          .forEach((c) => top.add(c.contractID));
      }
    }

    const map = new Map<string, CellView>();
    for (const c of cells) {
      const colors =
        c.chgPct !== null
          ? pctChangeToCellColors(c.chgPct * 100, p5, p95, 'bright')
          : null;
      map.set(c.contractID, {
        bg: colors?.bg ?? null,
        fg: colors && colors.fg !== 'inherit' ? colors.fg : null,
        shadow: colors && colors.shadow !== 'none' ? colors.shadow : null,
        isTop: top.has(c.contractID),
      });
    }
    return map;
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
}
