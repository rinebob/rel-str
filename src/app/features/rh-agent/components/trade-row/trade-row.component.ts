/**
 * Trade Row
 *
 * A single row in the RH Agent order page: toggle, symbol, direction, signal,
 * editable size/stop, and row actions.
 */
import { Component, inject, ChangeDetectionStrategy, OnInit, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SignalDirection, RhAgentSignalItem } from '../../services/rh-agent.types';
import { SignalTimeframe } from '../../common/rh-agent.constants';
import { RhAgentSignalService } from '../../services/rh-agent-signal.service';

export interface TradeRow {
  symbol: string;
  direction: SignalDirection;
  signalType: string;
  barDate: string;
  timeframe: SignalTimeframe;
  positionSize: number;
  stopLossPercent: number;
  entryPrice: number;
  enabled: boolean;
  executed: boolean;
  signal?: RhAgentSignalItem;
}

@Component({
  selector: 'app-trade-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatSlideToggleModule, MatTooltipModule],
  templateUrl: './trade-row.component.html',
  styleUrl: './trade-row.component.scss',
})
export class TradeRowComponent implements OnInit {
  private readonly signalService = inject(RhAgentSignalService);

  row = input.required<TradeRow>();
  maxPositionSize = input(100000);
  /** When false, mutation controls are disabled for this historical order row. */
  isActionableRun = input(true);

  toggleEnabled = output<string>();
  positionSizeChange = output<{ symbol: string; value: number }>();
  stopLossChange = output<{ symbol: string; value: number }>();
  copyTrade = output<TradeRow>();
  markExecuted = output<string>();
  remove = output<string>();
  signalLoaded = output<{ symbol: string; signal: RhAgentSignalItem | null }>();

  /** Load the latest signal for this row if it was not provided by the parent. */
  ngOnInit(): void {
    const symbol = this.row().symbol;
    if (this.row().signal) return;
    this.signalService.getSymbolSignalHistoryFromHistory(symbol).subscribe({
      next: (signals) => this.signalLoaded.emit({ symbol, signal: this.findLatestSignal(signals) }),
      error: () => this.signalLoaded.emit({ symbol, signal: null }),
    });
  }

  /** Return the most recent signal by barDate. */
  private findLatestSignal(signals: RhAgentSignalItem[]): RhAgentSignalItem | null {
    if (!signals?.length) return null;
    return signals.reduce((latest, s) => (s.barDate > latest.barDate ? s : latest));
  }

  /** Clamp position size and emit the change to the parent. */
  onPositionSizeChange(value: number): void {
    const clamped = Math.max(1, Math.min(value, this.maxPositionSize()));
    this.positionSizeChange.emit({ symbol: this.row().symbol, value: clamped });
  }

  /** Clamp stop loss percentage and emit the change to the parent. */
  onStopLossChange(value: number): void {
    const clamped = Math.max(0, Math.min(value, 100));
    this.stopLossChange.emit({ symbol: this.row().symbol, value: clamped });
  }
}
