import { ChangeDetectionStrategy, Component, EventEmitter, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { TradeJournalListItem } from './trade-journal.types';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * Standalone card component for displaying detailed information about a single trade
 * in the Trade Journal panel.
 */
@Component({
  selector: 'app-trade-journal-detail-card',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule],
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
