/**
 * Allocation Data Service — RobinhoodMcpClient wrappers assembling the
 * normalized inputs the allocation utils consume (Blueprint #582 / task
 * #586).
 *
 * Unlike the dashboard's agentic-only flows, allocation reads EVERY
 * account `get_accounts` returns — non-agentic accounts support bucket
 * management + manual assignment even though order placement isn't
 * allowed there.
 */
import { Injectable, inject } from '@angular/core';

import { RobinhoodMcpClient } from '../../core/robinhood-mcp/robinhood-mcp-client.service';
import type {
  AccountInfo,
  PortfolioSnapshot,
} from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import type {
  AllocationFillInput,
  AllocationPositionInput,
} from '@portfolio-allocation/utils';
import { toFillInputs, toPositionInputs } from './allocation-mappers';

@Injectable({ providedIn: 'root' })
export class AllocationDataService {
  private readonly mcp = inject(RobinhoodMcpClient);

  /** ALL live accounts — the agenticAllowed flag is surfaced, not filtered. */
  async listAccounts(): Promise<AccountInfo[]> {
    return this.mcp.getAccounts();
  }

  /** Account snapshot — `cash` is the broker-reported allocation basis. */
  async getSnapshot(accountNumber: string): Promise<PortfolioSnapshot> {
    return this.mcp.getPortfolio(accountNumber);
  }

  /**
   * Positions as allocation inputs — equity + option positions priced via
   * quotes (equity by symbol, option by instrumentId with the ×100
   * contract multiplier inside the mapper).
   */
  async getPositions(accountNumber: string): Promise<AllocationPositionInput[]> {
    const [equities, options] = await Promise.all([
      this.mcp.getEquityPositions(accountNumber),
      this.mcp.getOptionPositions(accountNumber, true),
    ]);
    const [equityQuotes, optionQuotes] = await Promise.all([
      this.mcp.getEquityQuotes(equities.map((p) => p.symbol).filter(Boolean)),
      this.mcp.getOptionQuotes(options.map((p) => p.instrumentId).filter(Boolean)),
    ]);
    return toPositionInputs(equities, options, equityQuotes, optionQuotes);
  }

  /**
   * Order history as allocation fills — equity + option orders expanded
   * per instrument; equity sell→close inferred from current positions.
   */
  async getFills(accountNumber: string): Promise<AllocationFillInput[]> {
    const [equityOrders, optionOrders, equityPositions] = await Promise.all([
      this.mcp.getEquityOrders(accountNumber),
      this.mcp.getOptionOrders(accountNumber),
      this.mcp.getEquityPositions(accountNumber),
    ]);
    const positionsBySymbol = new Map(equityPositions.map((p) => [p.symbol, p]));
    return toFillInputs([...equityOrders, ...optionOrders], positionsBySymbol);
  }
}
