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
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { TradeJournalListItem } from './trade-journal.mocks';
import { NewTradeDialogComponent, NewTradeDialogResult } from './new-trade.dialog';
import { TradeJournalStore } from './trade-journal.store';

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
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  templateUrl: './trade-journal.view.html',
  styleUrls: ['./trade-journal.view.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TradeJournalViewComponent {
  private readonly dialog = inject(MatDialog);
  private readonly store = inject(TradeJournalStore);
  readonly displayedColumns = ['symbol', 'direction', 'status', 'entryDate', 'exitDate', 'pnl', 'context'];

  readonly trades = signal<TradeJournalListItem[]>(this.store.trades());

  readonly selectedTradeId = signal<string | null>(null);

  selectTrade(id: string): void {
    this.selectedTradeId.set(id);
  }

  openNewTrade(): void {
    const ref = this.dialog.open<NewTradeDialogComponent, unknown, NewTradeDialogResult | undefined>(NewTradeDialogComponent, {
      width: 'auto',
      maxWidth: '90vw',
    });

    ref.afterClosed().subscribe(async (result) => {
      // Allow cancel
      if (!result) {
        // eslint-disable-next-line no-console
        console.log('NewTradeDialog closed without result');
        return;
      }

      // eslint-disable-next-line no-console
      console.log('NewTradeDialog result', {
        symbol: result.symbol,
        direction: result.direction,
        status: result.status,
        entryPrice: result.entryPrice,
        entryDate: result.entryDate,
        entryTime: result.entryTime,
        brokerCsvFiles: result.brokerCsvFiles?.map((f) => f.name) ?? [],
        indicatorCsvFiles: result.indicatorCsvFiles?.map((f) => f.name) ?? [],
        screenshotFiles: result.screenshotFiles?.map((f) => f.name) ?? [],
      });

      const newId = await this.store.addTradeFromDialog(result);
      this.trades.set(this.store.trades());
      this.selectedTradeId.set(newId);
    });
  }
}
