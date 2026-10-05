/**
 * Gallery Card
 *
 * Card for the gallery view (#743/#754/#755): signal details, the derived
 * status chip and ticket-status line, and the decision toolbar — labeled
 * Trade / Reject / Paper actions for one-step decisions (#759), plus the
 * chart-popup stub (#756).
 */
import { Component, ChangeDetectionStrategy, booleanAttribute, computed, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SignalTimeframe } from '../../common/constants';
import { OrderTicketStatus } from '../../services/order-ticket.types';
import { GalleryCard, GalleryCardStatus, canRejectCard, canTradeCard, isSunkCard } from '../../utils/gallery-cards.util';

const STATUS_LABELS: Record<Exclude<GalleryCardStatus, 'pending'>, string> = {
  submitting: 'Submitting',
  resting: 'Resting',
  settled: 'Settled',
  failed: 'Failed',
  watched: 'Watched',
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
  [OrderTicketStatus.PAPER]: 'Paper',
};

/** Single action channel — one output to forward through the group shell. */
export type GalleryCardAction =
  | { type: 'trade' | 'reject' | 'paper'; card: GalleryCard };

@Component({
  selector: 'app-gallery-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  templateUrl: './gallery-card.component.html',
  styleUrl: './gallery-card.component.scss',
})
export class GalleryCardComponent {
  card = input.required<GalleryCard>();
  /** When true, the decision buttons are disabled (non-actionable run). */
  actionsDisabled = input(false, { transform: booleanAttribute });
  /** When true, a Trade/Paper/Reject is in flight on this card — the
   *  buttons stay disabled until it resolves (no double-stage/send). */
  actionBusy = input(false, { transform: booleanAttribute });

  action = output<GalleryCardAction>();

  readonly SignalTimeframe = SignalTimeframe;

  readonly sunk = computed(() => isSunkCard(this.card()));
  /** Per-button disabled state: the page-level flag, an in-flight action,
   *  or the card's own decidable state. Sunk/terminal cards expose only
   *  Restore (#755 review — a rejected card restaging would carry REJECT
   *  decisionIds whose removal silently un-rejects). */
  readonly tradeDisabled = computed(
    () => this.actionsDisabled() || this.actionBusy() || !canTradeCard(this.card()),
  );
  readonly paperDisabled = this.tradeDisabled;
  readonly rejectDisabled = computed(
    () => this.actionsDisabled() || this.actionBusy() || !canRejectCard(this.card()),
  );
  readonly statusLabel = computed(() => {
    const s = this.card().status;
    return s === 'pending' ? '' : STATUS_LABELS[s];
  });
  /** REJECTed card — drives the Restore label/active state. `allRejected`
   *  covers a fully-rejected card that renders 'watched' (Monitor wins
   *  status precedence) — its REJECTs must stay restorable (#755 review). */
  readonly rejected = computed(
    () => this.card().status === 'rejected' || this.card().allRejected,
  );
  /** `limit 10 @ 210.50 · Resting` for quantity tickets; `market $200 ·
   *  Staged` for the dollar-based market tickets the signal stager emits. */
  readonly ticketLine = computed(() => {
    const t = this.card().ticket;
    if (!t) return '';
    const terms = t.quantity ? `${t.quantity} @ ${t.limitPrice ?? 'mkt'}` : `$${t.dollarAmount ?? '—'}`;
    return `${t.orderType} ${terms} · ${TICKET_STATUS_LABELS[t.status]}`;
  });
}
