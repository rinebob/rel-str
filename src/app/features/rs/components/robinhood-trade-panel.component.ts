/**
 * Robinhood Trade Panel Component
 *
 * Displays trade prompts ready to copy-paste into Claude Code.
 */
import { Component, Input, Output, EventEmitter } from '@angular/core';
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
    MatSnackBarModule
  ],
  template: `
    <mat-card class="trade-panel">
      <mat-card-header>
        <mat-card-title>
          <mat-icon>account_balance</mat-icon>
          Robinhood Trades (Agentic Account)
        </mat-card-title>
        <mat-card-subtitle>Copy-paste into Claude Code</mat-card-subtitle>
      </mat-card-header>

      <mat-card-content>
        <!-- Single Trade Mode -->
        @if (singleTrade) {
          <div class="trade-section">
            <h3>Single Trade</h3>
            <div class="prompt-box">
              <pre>{{ singleTrade.promptText }}</pre>
            </div>
            <button mat-raised-button color="primary" (click)="copyTrade(singleTrade)">
              <mat-icon>content_copy</mat-icon>
              Copy to Clipboard
            </button>
          </div>
        }

        <!-- Batch Trade Mode -->
        @if (batch) {
          <div class="trade-section">
            <h3>Batch Trade ({{ batch.trades.length }} orders, $ {{ batch.totalAmount }})</h3>
            
            <div class="individual-trades">
              @for (trade of batch.trades; track trade.symbol; let i = $index) {
                <div class="trade-item">
                  <span class="trade-number">{{ i + 1 }}.</span>
                  <span class="trade-details">
                    {{ trade.side.toUpperCase() }} $ {{ trade.amount }} {{ trade.symbol }}
                  </span>
                </div>
              }
            </div>

            <div class="prompt-box batch">
              <pre>{{ batch.batchPrompt }}</pre>
            </div>
            
            <button mat-raised-button color="primary" (click)="copyBatch()">
              <mat-icon>content_copy</mat-icon>
              Copy Batch Prompt
            </button>
          </div>
        }

        <!-- Instructions -->
        <div class="instructions">
          <h4>Next Steps:</h4>
          <ol>
            <li>Click "Copy to Clipboard" above</li>
            <li>Open Claude Code (should already have robinhood-trading MCP connected)</li>
            <li>Paste and press Enter</li>
            <li>Claude will review and place the order(s)</li>
            <li>Check your Robinhood Agentic account for confirmation</li>
          </ol>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [`
    .trade-panel {
      max-width: 600px;
      margin: 20px auto;
    }

    mat-card-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .trade-section {
      margin: 20px 0;
    }

    .prompt-box {
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 16px;
      margin: 12px 0;
    }

    .prompt-box pre {
      margin: 0;
      white-space: pre-wrap;
      font-family: 'Courier New', monospace;
      font-size: 14px;
    }

    .individual-trades {
      margin: 12px 0;
      padding: 12px;
      background: #fafafa;
      border-radius: 4px;
    }

    .trade-item {
      display: flex;
      gap: 8px;
      padding: 4px 0;
    }

    .trade-number {
      font-weight: bold;
      color: #666;
      min-width: 24px;
    }

    .instructions {
      margin-top: 24px;
      padding: 16px;
      background: #e3f2fd;
      border-radius: 4px;
    }

    .instructions h4 {
      margin-top: 0;
    }

    .instructions ol {
      margin: 0;
      padding-left: 20px;
    }

    .instructions li {
      margin: 8px 0;
    }

    button {
      margin-top: 12px;
    }
  `]
})
export class RobinhoodTradePanelComponent {
  @Input() singleTrade?: TradePrompt;
  @Input() batch?: TradeBatch | null;
  @Output() copied = new EventEmitter<void>();

  constructor(
    private tradeService: RobinhoodTradeService,
    private snackBar: MatSnackBar
  ) {}

  async copyTrade(trade: TradePrompt): Promise<void> {
    const success = await this.tradeService.copyToClipboard(trade.promptText);
    this.showResult(success, `Copied: ${trade.side.toUpperCase()} $${trade.amount} ${trade.symbol}`);
  }

  async copyBatch(): Promise<void> {
    if (!this.batch) return;
    const success = await this.tradeService.copyToClipboard(this.batch.batchPrompt);
    this.showResult(success, `Copied batch of ${this.batch.trades.length} trades`);
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
