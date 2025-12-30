import { ChangeDetectionStrategy, Component, EventEmitter, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TradeJournalListItem } from './trade-journal.types';

@Component({
  selector: 'app-trade-journal-table',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatIconModule],
  templateUrl: './trade-journal-table.component.html',
  styleUrls: ['./trade-journal-table.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TradeJournalTableComponent {
  readonly trades = input.required<TradeJournalListItem[]>();
  readonly selectedTradeId = input<string | null>(null);

  readonly select = output<string>();
  readonly edit = output<TradeJournalListItem>();
  readonly delete = output<TradeJournalListItem>();

  readonly displayedColumns: string[] = [
    'symbol',
    'direction',
    'status',
    'entryDate',
    'entryPrice',
    'currentPrice',
    'exitDate',
    'exitPrice',
    'pnl',
    'actions',
  ];

  onRowClick(row: TradeJournalListItem): void {
    this.select.emit(row.id);
  }

  onEditClick(event: MouseEvent, row: TradeJournalListItem): void {
    event.stopPropagation();
    this.edit.emit(row);
  }

  onDeleteClick(event: MouseEvent, row: TradeJournalListItem): void {
    event.stopPropagation();
    this.delete.emit(row);
  }
}
