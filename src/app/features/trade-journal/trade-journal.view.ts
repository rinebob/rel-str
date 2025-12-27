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
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { TRADE_JOURNAL_MOCK_TRADES, TradeDirection, TradeJournalListItem, TradeStatus } from './trade-journal.mocks';
import { NewTradeDialogComponent } from './new-trade.dialog';

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
    MatDialogModule,
  ],
  templateUrl: './trade-journal.view.html',
  styleUrls: ['./trade-journal.view.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TradeJournalViewComponent {
  private readonly dialog = inject(MatDialog);
  readonly displayedColumns = ['symbol', 'direction', 'status', 'entryDate', 'exitDate', 'pnl', 'context'];

  // Placeholder data; will be replaced by store-backed data in a later phase.
  readonly trades = signal<TradeJournalListItem[]>(TRADE_JOURNAL_MOCK_TRADES);

  readonly selectedTradeId = signal<string | null>(null);

  // Shape returned from NewTradeDialogComponent
  private buildTradeFromDialog(result: {
    symbol: string;
    direction: string;
    status: string;
    entryPrice: number;
    entryDate: string;
    entryTime: string;
  }): TradeJournalListItem {
    const id = `t-${result.symbol.toLowerCase()}-${Date.now()}`;

    const safeDirection =
      result.direction === TradeDirection.SHORT ? TradeDirection.SHORT : TradeDirection.LONG;

    const safeStatus =
      result.status === TradeStatus.CLOSED
        ? TradeStatus.CLOSED
        : result.status === TradeStatus.CANCELED
        ? TradeStatus.CANCELED
        : TradeStatus.OPEN;

    return {
      id,
      symbol: result.symbol.toUpperCase(),
      direction: safeDirection,
      status: safeStatus,
      entryDate: result.entryDate,
      exitDate: null,
      pnlPct: null,
    };
  }

  selectTrade(id: string): void {
    this.selectedTradeId.set(id);
  }

  openNewTrade(): void {
    const ref = this.dialog.open(NewTradeDialogComponent, {
      width: 'auto',
      maxWidth: '90vw',
    });

    ref.afterClosed().subscribe((result) => {
      // Allow cancel
      if (!result) {
        // eslint-disable-next-line no-console
        console.log('NewTradeDialog closed without result');
        return;
      }

      // eslint-disable-next-line no-console
      console.log('NewTradeDialog result', result);

      const newTrade = this.buildTradeFromDialog(result);
      this.trades.update((current) => [newTrade, ...current]);
      this.selectedTradeId.set(newTrade.id);
    });
  }
}
