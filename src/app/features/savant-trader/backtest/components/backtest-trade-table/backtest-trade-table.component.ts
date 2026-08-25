/**
 * Reusable backtest trades table.
 */
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import type { BacktestTradeUi } from '../../common/backtest.types';

@Component({
  selector: 'app-backtest-trade-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './backtest-trade-table.component.html',
  styleUrl: './backtest-trade-table.component.scss',
})
export class BacktestTradeTableComponent {
  readonly trades = input<BacktestTradeUi[] | undefined>(undefined);

  formatPnL(trade: BacktestTradeUi): string {
    return `${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }

  formatReturn(trade: BacktestTradeUi): string {
    return `${trade.returnPct >= 0 ? '+' : ''}${trade.returnPct.toFixed(1)}%`;
  }
}
