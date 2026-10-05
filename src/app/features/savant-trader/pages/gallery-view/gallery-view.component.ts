/**
 * Gallery View Page
 *
 * The gallery's page shell (#743/#754): header with filters + group dimension, a
 * scrollable stack of expando groups whose bodies are responsive card grids
 * (#783), and empty states. The card toolbar's Trade/Reject/Paper actions
 * dispatch through here (#755/#759) — Trade opens the staged ticket in a
 * dialog; a cancelled dialog discards the ticket it created.
 * Charts (#756) attach to the card shell in a later task; the card grid is
 * intentionally card-type-agnostic per ADR-009.
 */
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { GalleryFacade } from '../../stores/gallery.facade';
import { GalleryCardActionsService } from '../../stores/gallery-card-actions.service';
import { GalleryHeaderComponent } from '../../components/gallery-header/gallery-header.component';
import { GalleryGroupComponent } from '../../components/gallery-group/gallery-group.component';
import { GalleryCardAction } from '../../components/gallery-card/gallery-card.component';
import { GalleryTicketDialogComponent } from '../../components/gallery-ticket-dialog/gallery-ticket-dialog.component';
import { GalleryCard } from '../../utils/gallery-cards.util';

@Component({
  selector: 'app-gallery-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GalleryHeaderComponent, GalleryGroupComponent],
  templateUrl: './gallery-view.component.html',
  styleUrl: './gallery-view.component.scss',
})
export class GalleryViewComponent implements OnInit {
  readonly facade = inject(GalleryFacade);
  readonly actions = inject(GalleryCardActionsService);
  private readonly dialog = inject(MatDialog);

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
