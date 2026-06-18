/**
 * Robinhood Trade Panel Component
 *
 * Displays trade prompts ready to copy-paste into Claude Code.
 */
import { Component, Input, Output, EventEmitter, Optional, Inject, signal, computed } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RobinhoodTradeService, TradePrompt, TradeBatch } from '../services/robinhood-trade.service';

@Component({
  selector: 'app-robinhood-trade-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
  ],
  templateUrl: './robinhood-trade-panel.component.html',
  styleUrl: './robinhood-trade-panel.component.scss',
})
export class RobinhoodTradePanelComponent {
  @Input() singleTrade?: TradePrompt;
  @Input() batch?: TradeBatch | null;
  @Output() copied = new EventEmitter<void>();
  @Output() tradeRemoved = new EventEmitter<string>(); // Emits symbol to remove

  // Mutable list of trades for dynamic removal
  private removedSymbols = signal<Set<string>>(new Set());

  // Computed visible trades (excluding removed)
  visibleTrades = computed(() => {
    const batch = this.batch || this.dialogData?.batch;
    if (!batch) return [];
    const removed = this.removedSymbols();
    return batch.trades.filter(t => !removed.has(t.symbol));
  });

  // Computed batch prompt with only visible trades
  computedBatchPrompt = computed(() => {
    const trades = this.visibleTrades();
    if (trades.length === 0) return '';
    const total = trades.reduce((sum, t) => sum + t.amount, 0);
    const tradeList = trades.map((t, i) => 
      `${i + 1}. Place a market buy order for $${t.amount.toFixed(2)} of ${t.symbol}\nAccount: Agentic (••••6245)\nOrder Type: MARKET\nTime in Force: GFD (Good for Day)`
    ).join('\n\n');
    return `Execute these trades in my Agentic account (••••6245):\n\n${tradeList}\n\nTotal: $${total.toFixed(2)} for ${trades.length} orders`;
  });

  // Computed total amount
  computedTotalAmount = computed(() => {
    return this.visibleTrades().reduce((sum, t) => sum + t.amount, 0);
  });

  constructor(
    private tradeService: RobinhoodTradeService,
    private snackBar: MatSnackBar,
    @Optional() @Inject(MAT_DIALOG_DATA) private dialogData?: { batch?: TradeBatch },
    @Optional() private dialogRef?: MatDialogRef<RobinhoodTradePanelComponent>
  ) {}

  closeDialog(): void {
    this.dialogRef?.close();
  }

  // Get original batch from either @Input or dialog data
  get effectiveBatch(): TradeBatch | null | undefined {
    return this.batch || this.dialogData?.batch;
  }

  async copyTrade(trade: TradePrompt): Promise<void> {
    const success = await this.tradeService.copyToClipboard(trade.promptText);
    this.showResult(success, `Copied: ${trade.side.toUpperCase()} $${trade.amount} ${trade.symbol}`);
  }

  async copyBatch(): Promise<void> {
    const prompt = this.computedBatchPrompt();
    if (!prompt) return;
    const trades = this.visibleTrades();
    const success = await this.tradeService.copyToClipboard(prompt);
    this.showResult(success, `Copied batch of ${trades.length} trades`);
  }

  removeTrade(symbol: string): void {
    // Add to removed set (updates computed signals)
    this.removedSymbols.update(set => {
      const newSet = new Set(set);
      newSet.add(symbol);
      return newSet;
    });
    this.tradeRemoved.emit(symbol);
    this.snackBar.open(`Removed ${symbol} from batch (moved to Considered)`, 'Dismiss', { duration: 2000 });
  }

  private showResult(success: boolean, message: string): void {
    if (success) {
      this.snackBar.open(message, 'Dismiss', { duration: 3000 });
      this.copied.emit();
    } else {
      this.snackBar.open('Failed to copy. Please copy manually.', 'Dismiss', { duration: 5000 });
    }
  }
}
