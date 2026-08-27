/**
 * Portfolio Service
 *
 * Fetches the canonical account snapshot used by the order workspace.
 */
import { Injectable, inject } from '@angular/core';
import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';
import { getNestedNumber } from '../utils/mcp-response.util';

export interface AccountSnapshot {
  accountValue: number;
  exposure: number;
  cash: number;
  positionCount: number;
  units: number;
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
    const positions = this.getPositions(positionsResult.parsed);
    if (accountValue === null || exposure === null || cash === null || positions === null) {
      console.warn('[PortfolioService] Incomplete account snapshot response');
      return null;
    }

    return {
      accountValue,
      exposure,
      cash,
      positionCount: positions.length,
      units: defaultDollarAmount > 0 ? Math.round((exposure / defaultDollarAmount) * 100) / 100 : 0,
    };
  }

  private getPositions(parsed: unknown): unknown[] | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const data = (parsed as Record<string, unknown>)['data'];
    if (!data || typeof data !== 'object') return null;
    const positions = (data as Record<string, unknown>)['positions'];
    return Array.isArray(positions) ? positions : null;
  }
}
