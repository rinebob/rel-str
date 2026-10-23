/**
 * Gallery Card
 *
 * Card for the gallery view (#743/#754/#755): signal details, the derived
 * status chip and ticket-status line, and the action toolbar — labeled
 * Trade / Reject / Paper actions for one-step orders (#759), plus the
 * @defer-mounted card chart cell (#756).
 */
import { Component, ChangeDetectionStrategy, booleanAttribute, computed, inject, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AppRoutes } from '../../../../core/common/interfaces';
import { GalleryCardChartComponent } from '../gallery-card-chart/gallery-card-chart.component';
import { GalleryCardChartStore } from '../../stores/gallery-card-chart.store';
import { SignalTimeframe } from '../../common/constants';
import { OrderTicketStatus } from '../../services/order-ticket.types';
import { orderTicketTerms } from '../../utils/signal-order-staging.util';
import { GalleryCard, GalleryCardStatus } from '../../utils/gallery-cards.util';
import {
  canRejectCard,
  canRequeueCard,
  canTradeCard,
  GALLERY_MANUAL_PAPER_ENABLED,
  isActionedCard,
} from '../../utils/gallery-card-actions.util';
import { tierLabel } from '../../utils/utils';

const STATUS_LABELS: Record<Exclude<GalleryCardStatus, 'pending'>, string> = {
  submitting: 'Submitting',
  resting: 'Resting',
  settled: 'Settled',
  failed: 'Failed',
  rejected: 'Rejected',
};

const TICKET_STATUS_LABELS: Record<OrderTicketStatus, string> = {
  [OrderTicketStatus.STAGED]: 'Staged',
  [OrderTicketStatus.SUBMITTING]: 'Submitting',
  [OrderTicketStatus.SUBMITTED]: 'Submitted',
  [OrderTicketStatus.QUEUED]: 'Queued',
  [OrderTicketStatus.RESTING]: 'Resting',
  [OrderTicketStatus.FILLED]: 'Filled',
  [OrderTicketStatus.FAILED]: 'Failed',
  [OrderTicketStatus.CANCELLED]: 'Cancelled',
  [OrderTicketStatus.CANCEL_PENDING]: 'Cancelling',
  [OrderTicketStatus.EXPIRED]: 'Expired',
  [OrderTicketStatus.PAPER]: 'Paper',
};

/** Single action channel — one output to forward through the group shell. */
export type GalleryCardAction =
  | { type: 'trade' | 'reject' | 'paper' | 'requeue'; card: GalleryCard };

@Component({
  selector: 'app-gallery-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, RouterLink, GalleryCardChartComponent],
  templateUrl: './gallery-card.component.html',
  styleUrl: './gallery-card.component.scss',
})
export class GalleryCardComponent {
  card = input.required<GalleryCard>();
  /** When true, the action buttons are disabled (non-actionable run). */
  actionsDisabled = input(false, { transform: booleanAttribute });
  /** When true, a Trade/Paper/Reject is in flight on this card — the
   *  buttons stay disabled until it resolves (no double-stage/send). */
  actionBusy = input(false, { transform: booleanAttribute });

  action = output<GalleryCardAction>();

  readonly SignalTimeframe = SignalTimeframe;
  /** Route enum for the Option chain deep link (#1055). */
  readonly OPTION_CHAIN_ROUTE = AppRoutes.OPTION_CHAIN;
  /** Route enum for the ticket-line order deep link (#762). */
  readonly ORDER_ROUTE = AppRoutes.SIGNAL_ORDER;
  readonly tierLabel = tierLabel;

  private readonly chartStore = inject(GalleryCardChartStore);

  /** Last-close price + day-over-day change from the card's prefetched
   *  daily bars — renders on the financial meta row once the idle
   *  prefetch lands; absent until then (leaf selector, cheap reads). */
  readonly priceChange = computed(() => {
    const bars = this.chartStore.barsFor()(this.card().symbol);
    if (!bars || bars.length < 2) return undefined;
    const price = bars[bars.length - 1].close;
    const prev = bars[bars.length - 2].close;
    if (!prev) return undefined;
    const change = price - prev;
    return { price, change, pct: (change / prev) * 100 };
  });

  readonly actioned = computed(() => isActionedCard(this.card()));
  /** Per-button disabled state: the page-level flag, an in-flight action,
   *  or the card's own decidable state. Actioned cards expose the inverse
   *  of the action that actioned them — rejected →
   *  Restore, failed → Requeue/Reject; settled is terminal. */
  readonly tradeDisabled = computed(
    () => this.actionsDisabled() || this.actionBusy() || !canTradeCard(this.card()),
  );
  /** Manual Paper is hidden while GALLERY_MANUAL_PAPER_ENABLED=false —
   *  auto-paper ingest captures qualifying signals at run completion, so
   *  a manual send has no use case. Flip the flag to restore the button. */
  readonly manualPaperEnabled = GALLERY_MANUAL_PAPER_ENABLED;
  /** Paper shares Trade's precondition, but is its own computed —
   *  an alias would silently couple the buttons if paper's rule ever
   *  diverges (#819 r2). Reached only when manualPaperEnabled renders
   *  the button. */
  readonly paperDisabled = computed(
    () => this.actionsDisabled() || this.actionBusy() || !GALLERY_MANUAL_PAPER_ENABLED || !canTradeCard(this.card()),
  );
  readonly rejectDisabled = computed(
    () => this.actionsDisabled() || this.actionBusy() || !canRejectCard(this.card()),
  );
  readonly requeueDisabled = computed(
    () => this.actionsDisabled() || this.actionBusy() || !canRequeueCard(this.card()),
  );
  readonly statusLabel = computed(() => {
    const s = this.card().status;
    return s === 'pending' ? '' : STATUS_LABELS[s];
  });
  /** REJECTed card — drives the Restore label/active state. `allRejected`
   *  belts-and-braces the status so session rejects stay restorable even
   *  if a card's status derivation ever lags the reject map (#1017). */
  readonly rejected = computed(
    () => this.card().status === 'rejected' || this.card().allRejected,
  );
  /** `limit 10 @ 210.50 · Resting` for quantity tickets; `market $200 ·
   *  Staged` for the dollar-based market tickets the signal stager emits.
   *  Option tickets (#964) render `opt 2 @ 1.25` — quantity is contracts
   *  and the price field is `price`, not `limitPrice`. */
  readonly ticketLine = computed(() => {
    const t = this.card().ticket;
    if (!t) return '';
    return `${t.orderType} ${orderTicketTerms(t)} · ${TICKET_STATUS_LABELS[t.status]}`;
  });
}
