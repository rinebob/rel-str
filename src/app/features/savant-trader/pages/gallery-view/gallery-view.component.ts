/**
 * Gallery View Page
 *
 * The gallery's page shell (#743/#754): header with filters + group dimension, a
 * scrollable stack of expando groups whose bodies are responsive card grids
 * (#783) — or a flat market-cap-sorted grid when the Group dimension is None
 * (#820, the pinned Sunk panel still renders below) — and empty states. The card toolbar's Trade/Reject/Paper actions
 * dispatch through here (#755/#759) — Trade opens the staged ticket in a
 * dialog; a cancelled dialog discards the ticket it created.
 * Charts (#756) mount inside each card's @defer cell; this page warms the
 * card-chart store on idle for the visible card set. The card grid is
 * intentionally card-type-agnostic per ADR-009.
 */
import { ChangeDetectionStrategy, Component, effect, inject, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { GalleryFacade } from '../../stores/gallery.facade';
import { GalleryCardActionsService } from '../../stores/gallery-card-actions.service';
import { GalleryCardChartStore } from '../../stores/gallery-card-chart.store';
import { GalleryHeaderComponent } from '../../components/gallery-header/gallery-header.component';
import { GalleryGroupComponent } from '../../components/gallery-group/gallery-group.component';
import { GalleryCardAction, GalleryCardComponent } from '../../components/gallery-card/gallery-card.component';
import { GalleryTicketDialogComponent } from '../../components/gallery-ticket-dialog/gallery-ticket-dialog.component';
import { GalleryCard } from '../../utils/gallery-cards.util';

/** Idle scheduling with a setTimeout fallback (jsdom + older browsers).
 *  One capability check for both halves — a mixed environment could
 *  schedule via setTimeout then try cancelIdleCallback (#819 r2).
 *  window.setTimeout returns number under the DOM lib — no cast needed. */
const HAS_IDLE_CALLBACK =
  typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function';

function scheduleIdle(cb: () => void): number {
  return HAS_IDLE_CALLBACK ? requestIdleCallback(cb) : window.setTimeout(cb, 0);
}

function cancelIdle(id: number): void {
  if (HAS_IDLE_CALLBACK) cancelIdleCallback(id); else clearTimeout(id);
}

@Component({
  selector: 'app-gallery-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GalleryHeaderComponent, GalleryGroupComponent, GalleryCardComponent],
  templateUrl: './gallery-view.component.html',
  styleUrl: './gallery-view.component.scss',
})
export class GalleryViewComponent implements OnInit {
  readonly facade = inject(GalleryFacade);
  readonly actions = inject(GalleryCardActionsService);
  private readonly cardCharts = inject(GalleryCardChartStore);
  private readonly dialog = inject(MatDialog);

  constructor() {
    // #756 — warm per-symbol daily bars on idle after first paint so the
    // @defer-mounted card charts render without a data wait. The store
    // dedupes per symbol — the effect re-schedules on every visibleCards
    // array change (even identity-retained ones), but prefetch() is a
    // no-op for cached symbols so the reschedules are cheap.
    effect((onCleanup) => {
      const symbols = new Set(this.facade.visibleCards().map((c) => c.symbol));
      if (symbols.size === 0) return;
      const id = scheduleIdle(() => this.cardCharts.prefetch(symbols));
      onCleanup(() => cancelIdle(id));
    });
  }

  ngOnInit(): void {
    this.facade.enterGallery();
    this.actions.warmConfig();
  }

  /** Dispatch a card toolbar event (#755/#759). */
  onCardAction(action: GalleryCardAction): void {
    switch (action.type) {
      case 'reject': this.actions.rejectCard(action.card); break;
      case 'paper': void this.actions.paperCard(action.card); break;
      case 'trade': void this.openTicketDialog(action.card); break;
    }
  }

  /** Trade: stage/reopen the card's ticket and open it in the dialog.
   *  Closing while still STAGED discards the ticket — but only when this
   *  click created it; a reopened pre-existing ticket survives (#759). */
  private async openTicketDialog(card: GalleryCard): Promise<void> {
    const staged = await this.actions.tradeCard(card);
    if (!staged) return;
    const ref = this.dialog.open(GalleryTicketDialogComponent, {
      data: { ticketId: staged.ticket.id, tradingConfig: this.actions.config },
      width: '560px',
      autoFocus: false,
    });
    ref.afterClosed().subscribe(() => {
      if (staged.created) this.actions.discardStagedTicket(staged.ticket.id);
    });
  }
}
