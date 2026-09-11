/**
 * Portfolio Service
 *
 * Fetches the canonical account snapshot used by the order workspace.
 */
import { Injectable, inject } from '@angular/core';
import { RobinhoodMcpObservationService } from '../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { getNestedNumber } from '../utils/mcp-response.util';

export interface BrokerPosition {
  symbol: string;
  quantity: string;
  averageBuyPrice: string;
  sharesHeldForSells: string;
}

export interface AccountSnapshot {
  accountValue: number;
  exposure: number;
  cash: number;
  positionCount: number;
  units: number;
  positions: BrokerPosition[];
}

@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private readonly mcpService = inject(RobinhoodMcpObservationService);

  async getSnapshot(accountNumber: string, defaultDollarAmount: number): Promise<AccountSnapshot | null> {
    const request = { args: { account_number: accountNumber } };
    const [portfolioResult, positionsResult] = await Promise.all([
      this.mcpService.executeTool('get_portfolio', request),
      this.mcpService.executeTool('get_equity_positions', request),
    ]);
    if (!portfolioResult.success) {
      console.error('[PortfolioService] Account snapshot failed:', portfolioResult.error);
      return null;
    }
    if (!positionsResult.success) {
      console.error('[PortfolioService] Account snapshot failed:', positionsResult.error);
      return null;
    }

    const accountValue = getNestedNumber(portfolioResult.parsed, 'data', 'total_value');
    const exposure = getNestedNumber(portfolioResult.parsed, 'data', 'equity_value');
    const cash = getNestedNumber(portfolioResult.parsed, 'data', 'cash');
    const rawPositions = this.getPositions(positionsResult.parsed);
    if (accountValue === null || exposure === null || cash === null || rawPositions === null) {
      console.warn('[PortfolioService] Incomplete account snapshot response');
      return null;
    }
    const positions = this.toBrokerPositions(rawPositions);

    return {
      accountValue,
      exposure,
      cash,
      positionCount: rawPositions.length,
      units: defaultDollarAmount > 0 ? Math.round((exposure / defaultDollarAmount) * 100) / 100 : 0,
      positions,
    };
  }

  private getPositions(parsed: unknown): Record<string, unknown>[] | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const data = (parsed as Record<string, unknown>)['data'];
    if (!data || typeof data !== 'object') return null;
    const positions = (data as Record<string, unknown>)['positions'];
    return Array.isArray(positions)
      ? positions.filter((position): position is Record<string, unknown> =>
          typeof position === 'object' && position !== null)
      : null;
  }

  private toBrokerPositions(rawPositions: Record<string, unknown>[]): BrokerPosition[] {
    return rawPositions.flatMap((position) => {
      const symbol = typeof position['symbol'] === 'string' ? position['symbol'] : '';
      const quantity = String(position['quantity'] ?? '');
      const averageBuyPrice = String(position['average_buy_price'] ?? '');
      const sharesHeldForSells = String(position['shares_held_for_sells'] ?? '0');
      return symbol && quantity && averageBuyPrice
        ? [{ symbol, quantity, averageBuyPrice, sharesHeldForSells }]
        : [];
    });
  }
}
