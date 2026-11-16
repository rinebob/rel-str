/**
 * Portfolio Service
 *
 * Fetches the canonical account snapshot used by the order workspace.
 */
import { Injectable, inject } from '@angular/core';
import { RobinhoodMcpObservationService } from '../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
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
  private readonly mcpClient = inject(RobinhoodMcpClient);

  async getSnapshot(accountNumber: string, defaultDollarAmount: number): Promise<AccountSnapshot | null> {
    const request = { args: { account_number: accountNumber } };
    // Positions walk their `data.next` cursor through the canonical client
    // (#1474 — a page-1-only fetch silently drops deep positions). The
    // walk rejects on failure, so it's shaped back into the outcome union
    // to preserve the null-on-failure contract.
    const [portfolioResult, positionsOutcome] = await Promise.all([
      this.mcpService.executeTool('get_portfolio', request),
      this.mcpClient.getEquityPositionsRaw(accountNumber).then(
        (positions) => ({ ok: true as const, positions }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
    ]);
    if (!portfolioResult.success) {
      console.error('[PortfolioService] Account snapshot failed:', portfolioResult.error);
      return null;
    }
    if (!positionsOutcome.ok) {
      const err = positionsOutcome.err;
      console.error(
        '[PortfolioService] Account snapshot failed:',
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }

    const accountValue = getNestedNumber(portfolioResult.parsed, 'data', 'total_value');
    const exposure = getNestedNumber(portfolioResult.parsed, 'data', 'equity_value');
    const cash = getNestedNumber(portfolioResult.parsed, 'data', 'cash');
    const rawPositions = positionsOutcome.positions;
    if (accountValue === null || exposure === null || cash === null) {
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

  private toBrokerPositions(rawPositions: Record<string, unknown>[]): BrokerPosition[] {
    return rawPositions.flatMap((position) => {
      if (!position || typeof position !== 'object') return [];
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
