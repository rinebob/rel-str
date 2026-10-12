/**
 * Position Card (#926/#951)
 *
 * One held position as a gallery card — the position-gallery counterpart of
 * GalleryCardComponent with the triage layer stripped: no status lane, no
 * decision buttons, no sunk styling. Layout mirrors the signal card: meta
 * top block → chart cell → action row. Close/Stop emit the card action for
 * the page to dispatch (#953 wires the dialogs); Add/Detail/Orders are
 * disabled stubs until then.
 */
import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, output } from '@angular/core';

import { PositionCard } from '../../utils/position-cards.util';
import { fmtMoney, fmtNum, tierLabel } from '../../../../../savant-trader/utils/utils';

export type PositionCardAction = { type: 'close' | 'stop'; card: PositionCard };

@Component({
  selector: 'app-position-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './position-card.component.html',
  styleUrl: './position-card.component.scss',
})
export class PositionCardComponent {
  card = input.required<PositionCard>();
  /** Page-level disable (refresh in flight) for the actionable buttons. */
  actionsDisabled = input(false, { transform: booleanAttribute });

  action = output<PositionCardAction>();

  readonly tierLabel = tierLabel;

  /** Day change from the position's perspective: `card.dayChange` is the
   *  instrument's per-share move, but a short's per-share P&L is opposite —
   *  negate for shorts so the signed display is consistent with the P&L
   *  row beside it. */
  readonly dayChange = computed(() => {
    const v = this.card().dayChange;
    return v === null || this.card().side === 'long' ? v : -v;
  });
  readonly dayChangePct = computed(() => {
    const v = this.card().dayChangePct;
    return v === null || this.card().side === 'long' ? v : -v;
  });

  readonly stopLabel = computed(() => (this.card().protected ? 'Update Stop' : 'Add Stop'));
  readonly ordersLabel = computed(() =>
    this.card().openOrders.length ? `Orders (${this.card().openOrders.length})` : 'Orders',
  );

  /** Null-tolerant shared formatters. */
  readonly money = (v: number | null | undefined): string => fmtMoney(v ?? undefined);
  readonly num = (v: number | null | undefined): string => fmtNum(v ?? undefined);
  /** Signed money — `+$3.00` / `−$3.00` for day change and P&L. */
  readonly signedMoney = (v: number | null | undefined): string =>
    v == null ? '—' : `${v < 0 ? '−' : '+'}$${Math.abs(v).toFixed(2)}`;
  /** Signed percent — `+1.97%` / `−1.97%` (fields arrive already ×100). */
  readonly signedPct = (v: number | null | undefined): string =>
    v == null ? '—' : `${v < 0 ? '−' : '+'}${fmtNum(Math.abs(v))}%`;
  /** Unsigned percent — `(6.45%)` inside the protected badge. */
  readonly pct = (v: number | null | undefined): string =>
    v == null ? '—' : `${fmtNum(v)}%`;
}
