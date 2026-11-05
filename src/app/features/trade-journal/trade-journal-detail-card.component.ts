import { ChangeDetectionStrategy, Component, EventEmitter, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TradeJournalListItem } from './trade-journal.types';

/**
 * Standalone card component for displaying detailed information about a single trade
 * in the Trade Journal panel.
 */
@Component({
  selector: 'app-trade-journal-detail-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './trade-journal-detail-card.component.html',
  styleUrls: ['./trade-journal-detail-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TradeJournalDetailCardComponent {
  readonly trade = input.required<TradeJournalListItem | null>();
  readonly edit = output<TradeJournalListItem>();

  onEditClick(): void {
    const current = this.trade();
    if (current) {
      this.edit.emit(current);
    }
  }
}
