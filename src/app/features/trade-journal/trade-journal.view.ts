import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';

interface TradeJournalListItem {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  status: 'PLANNED' | 'OPEN' | 'CLOSED' | 'CANCELED';
  entryDate: string;
  exitDate?: string | null;
  pnlPct?: number | null;
}

@Component({
  selector: 'app-trade-journal-view',
  standalone: true,
  imports: [
    CommonModule,
    MatSidenavModule,
    MatToolbarModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
  ],
  templateUrl: './trade-journal.view.html',
  styleUrls: ['./trade-journal.view.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TradeJournalViewComponent {
  readonly displayedColumns = ['symbol', 'direction', 'status', 'entryDate', 'exitDate', 'pnl', 'context'];

  // Placeholder data; will be replaced by store-backed data in a later phase.
  readonly trades = signal<TradeJournalListItem[]>([]);

  readonly selectedTradeId = signal<string | null>(null);

  selectTrade(id: string): void {
    this.selectedTradeId.set(id);
  }

  openNewTrade(): void {
    // Placeholder: will open new trade dialog / panel in a later phase.
  }
}
