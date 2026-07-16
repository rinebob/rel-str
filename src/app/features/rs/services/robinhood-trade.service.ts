/**
 * Robinhood Trade Service
 *
 * Generates copy-pasteable trade prompts for Claude Code.
 * Interim solution until direct API access is available.
 */
import { Injectable } from '@angular/core';

export enum TradeSide {
  BUY = 'buy',
  SELL = 'sell',
}

export enum TradeOrderType {
  MARKET = 'market',
  LIMIT = 'limit',
}

export interface TradePrompt {
  symbol: string;
  side: TradeSide;
  amount: number;
  orderType: TradeOrderType;
  limitPrice?: number;
  promptText: string;
  estimatedShares?: number;
}

export interface TradeBatch {
  trades: TradePrompt[];
  totalAmount: number;
  batchPrompt: string;
}

@Injectable({
  providedIn: 'root'
})
export class RobinhoodTradeService {

  private readonly AGENTIC_ACCOUNT = '••••6245';

  /**
   * Generate a single trade prompt
   */
  generateTradePrompt(
    symbol: string,
    side: TradeSide,
    amount: number,
    orderType: TradeOrderType = TradeOrderType.MARKET,
    limitPrice?: number
  ): TradePrompt {
    const promptText = this.buildPrompt(symbol, side, amount, orderType, limitPrice);

    return {
      symbol: symbol.toUpperCase(),
      side,
      amount,
      orderType,
      limitPrice,
      promptText,
    };
  }

  /**
   * Generate a batch trade prompt for multiple orders
   */
  generateBatchPrompt(trades: Array<Omit<TradePrompt, 'promptText'>>): TradeBatch {
    const tradePrompts = trades.map(t => this.buildPrompt(
      t.symbol, t.side, t.amount, t.orderType, t.limitPrice
    ));

    const batchPrompt = `Execute these trades in my Agentic account (${this.AGENTIC_ACCOUNT}):

${tradePrompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Please confirm each order after review and place them sequentially.`;

    const totalAmount = trades.reduce((sum, t) => sum + t.amount, 0);

    return {
      trades: trades.map((t, i) => ({
        ...t,
        promptText: tradePrompts[i]
      })),
      totalAmount,
      batchPrompt
    };
  }

  /**
   * Build the Claude Code prompt text
   */
  private buildPrompt(
    symbol: string,
    side: TradeSide,
    amount: number,
    orderType: TradeOrderType,
    limitPrice?: number
  ): string {
    const lines = [
      `Place a ${orderType} ${side} order for $${amount.toFixed(2)} of ${symbol.toUpperCase()}`,
      `Account: Agentic (${this.AGENTIC_ACCOUNT})`,
      `Order Type: ${orderType.toUpperCase()}`
    ];

    if (orderType === TradeOrderType.LIMIT && limitPrice) {
      lines.push(`Limit Price: $${limitPrice.toFixed(2)}`);
    }

    lines.push(`Time in Force: GFD (Good for Day)`);

    return lines.join('\n');
  }

  /**
   * Copy text to clipboard
   */
  async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('Failed to copy:', err);
      return false;
    }
  }

  /**
   * Generate prompt from a trade signal
   * (Integrates with your existing signal system)
   */
  generateFromSignal(signal: {
    symbol: string;
    action: TradeSide;
    allocation: number; // percentage of portfolio
    portfolioValue: number;
  }): TradePrompt {
    const amount = (signal.portfolioValue * signal.allocation) / 100;

    return this.generateTradePrompt(
      signal.symbol,
      signal.action,
      Math.round(amount),
      TradeOrderType.MARKET
    );
  }
}
