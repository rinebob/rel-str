import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { RobinhoodMcpClient } from './robinhood-mcp-client.service';
import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';
import {
  AccountInfo,
  PortfolioSnapshot,
  EquityPosition,
  OptionPosition,
  EquityQuote,
  OptionQuote,
  BrokerOrder,
  RobinhoodMcpError,
} from './types/robinhood-mcp.types';
import { ToolExecutionErrorCategory, type ToolExecutionResult } from '@robinhood-mcp/contracts';

describe('RobinhoodMcpClient', () => {
  let client: RobinhoodMcpClient;
  let mcp: { executeTool: jasmine.Spy };

  beforeEach(() => {
    mcp = { executeTool: jasmine.createSpy('executeTool') };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        RobinhoodMcpClient,
        { provide: RobinhoodMcpObservationService, useValue: mcp },
      ],
    });
    client = TestBed.inject(RobinhoodMcpClient);
  });

  /** Helper: make executeTool return a resolved ToolExecutionResult. */
  function mockResolve(result: ToolExecutionResult): void {
    mcp.executeTool.and.callFake(() => Promise.resolve(result));
  }

  /** Helper: make executeTool return a failure result. */
  function mockFailure(error: string, category: ToolExecutionErrorCategory = ToolExecutionErrorCategory.MCP): void {
    mockResolve({ success: false, error, category });
  }

  // ===========================================================================
  // getAccounts
  // ===========================================================================

  describe('getAccounts', () => {
    it('returns agentic-allowed accounts from { data: { accounts: [...] } } shape', async () => {
      mockResolve({
        success: true,
        parsed: {
          data: {
            accounts: [
              { account_number: '123456789', type: 'brokerage', agentic_allowed: true, nickname: 'Main' },
              { account_number: '987654321', type: 'retirement', agentic_allowed: false },
              { account_number: '555444333', type: 'margin', agentic_allowed: true, nickname: 'Margin' },
            ],
          },
        },
        redacted: {},
        tool: 'get_accounts',
      });

      const accounts = await client.getAccounts();

      expect(accounts.length).toBe(2);
      expect(accounts[0]).toEqual({
        accountNumber: '123456789',
        accountName: 'Main',
        accountType: 'brokerage',
        agenticAllowed: true,
      } satisfies AccountInfo);
      expect(accounts[1]).toEqual({
        accountNumber: '555444333',
        accountName: 'Margin',
        accountType: 'margin',
        agenticAllowed: true,
      } satisfies AccountInfo);
    });

    it('returns agentic-allowed accounts from { accounts: [...] } shape', async () => {
      mockResolve({
        success: true,
        parsed: {
          accounts: [
            { account_number: '111222333', type: 'brokerage', agentic_allowed: true },
          ],
        },
        redacted: {},
        tool: 'get_accounts',
      });

      const accounts = await client.getAccounts();

      expect(accounts.length).toBe(1);
      expect(accounts[0].accountNumber).toBe('111222333');
      expect(accounts[0].accountName).toBe('');
    });

    it('returns agentic-allowed accounts from bare array shape', async () => {
      mockResolve({
        success: true,
        parsed: [
          { account_number: '444555666', type: 'brokerage', agentic_allowed: true, nickname: 'Acct' },
        ],
        redacted: {},
        tool: 'get_accounts',
      });

      const accounts = await client.getAccounts();

      expect(accounts.length).toBe(1);
      expect(accounts[0].accountNumber).toBe('444555666');
      expect(accounts[0].accountName).toBe('Acct');
    });

    it('returns empty array when no accounts are agentic-allowed', async () => {
      mockResolve({
        success: true,
        parsed: {
          data: {
            accounts: [
              { account_number: '123456789', type: 'retirement', agentic_allowed: false },
            ],
          },
        },
        redacted: {},
        tool: 'get_accounts',
      });

      const accounts = await client.getAccounts();

      expect(accounts.length).toBe(0);
    });

    it('throws RobinhoodMcpError when MCP call fails', async () => {
      mockFailure('Auth failed', ToolExecutionErrorCategory.AUTH);

      try {
        await client.getAccounts();
        fail('Expected getAccounts to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(RobinhoodMcpError);
        expect((err as RobinhoodMcpError).message).toBe('Auth failed');
        expect((err as RobinhoodMcpError).tool).toBe('get_accounts');
        expect((err as RobinhoodMcpError).category).toBe(ToolExecutionErrorCategory.AUTH);
      }
    });

    it('calls get_accounts with no args', async () => {
      mockResolve({
        success: true,
        parsed: { data: { accounts: [] } },
        redacted: {},
        tool: 'get_accounts',
      });

      await client.getAccounts();

      expect(mcp.executeTool).toHaveBeenCalledWith('get_accounts', {});
    });
  });

  // ===========================================================================
  // getPortfolio
  // ===========================================================================

  describe('getPortfolio', () => {
    it('returns portfolio snapshot with value, exposure, cash, buying power', async () => {
      mockResolve({
        success: true,
        parsed: {
          data: {
            total_value: '24964.02642795',
            equity_value: '163.80642795',
            cash: '24800.22',
            buying_power: { buying_power: '24800.2200' },
          },
        },
        redacted: {},
        tool: 'get_portfolio',
      });

      const snapshot = await client.getPortfolio('123456789');

      expect(snapshot).toEqual({
        totalValue: 24964.02642795,
        equityValue: 163.80642795,
        cash: 24800.22,
        buyingPower: 24800.22,
        marginExposure: null,
      } satisfies PortfolioSnapshot);
    });

    it('extracts buying power from flat shape', async () => {
      mockResolve({
        success: true,
        parsed: {
          data: {
            total_value: '50000',
            equity_value: '30000',
            cash: '20000',
            buying_power: '18000',
          },
        },
        redacted: {},
        tool: 'get_portfolio',
      });

      const snapshot = await client.getPortfolio('123456789');

      expect(snapshot.buyingPower).toBe(18000);
    });

    it('returns null for missing numeric fields', async () => {
      mockResolve({
        success: true,
        parsed: { data: {} },
        redacted: {},
        tool: 'get_portfolio',
      });

      const snapshot = await client.getPortfolio('123456789');

      expect(snapshot.totalValue).toBeNull();
      expect(snapshot.equityValue).toBeNull();
      expect(snapshot.cash).toBeNull();
      expect(snapshot.buyingPower).toBeNull();
      expect(snapshot.marginExposure).toBeNull();
    });

    it('throws RobinhoodMcpError when MCP call fails', async () => {
      mockFailure('Account not found', ToolExecutionErrorCategory.MCP);

      try {
        await client.getPortfolio('999999999');
        fail('Expected getPortfolio to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(RobinhoodMcpError);
        expect((err as RobinhoodMcpError).tool).toBe('get_portfolio');
      }
    });

    it('calls get_portfolio with account_number arg', async () => {
      mockResolve({
        success: true,
        parsed: { data: { total_value: '0', equity_value: '0', cash: '0', buying_power: { buying_power: '0' } } },
        redacted: {},
        tool: 'get_portfolio',
      });

      await client.getPortfolio('123456789');

      expect(mcp.executeTool).toHaveBeenCalledWith('get_portfolio', { args: { account_number: '123456789' } });
    });
  });

  // ===========================================================================
  // getEquityPositions
  // ===========================================================================

  describe('getEquityPositions', () => {
    it('returns equity positions from { data: { positions: [...] } } shape', async () => {
      mockResolve({
        success: true,
        parsed: {
          data: {
            positions: [
              { symbol: 'AAPL', quantity: '100', average_buy_price: '150.00', shares_held_for_sells: '0' },
              { symbol: 'NVDA', quantity: '50', average_buy_price: '800.00', shares_held_for_sells: '10' },
            ],
          },
        },
        redacted: {},
        tool: 'get_equity_positions',
      });

      const positions = await client.getEquityPositions('123456789');

      expect(positions.length).toBe(2);
      expect(positions[0]).toEqual({
        symbol: 'AAPL',
        quantity: 100,
        averageBuyPrice: 150,
        sharesHeldForSells: 0,
      } satisfies EquityPosition);
      expect(positions[1].sharesHeldForSells).toBe(10);
    });

    it('returns positions from { results: [...] } shape', async () => {
      mockResolve({
        success: true,
        parsed: {
          results: [
            { symbol: 'GOOG', quantity: '25', average_buy_price: '140.00', shares_held_for_sells: '0' },
          ],
        },
        redacted: {},
        tool: 'get_equity_positions',
      });

      const positions = await client.getEquityPositions('123456789');

      expect(positions.length).toBe(1);
      expect(positions[0].symbol).toBe('GOOG');
    });

    it('throws RobinhoodMcpError on failure', async () => {
      mockFailure('Auth expired', ToolExecutionErrorCategory.AUTH);

      try {
        await client.getEquityPositions('123456789');
        fail('Expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(RobinhoodMcpError);
        expect((err as RobinhoodMcpError).tool).toBe('get_equity_positions');
      }
    });
  });

  // ===========================================================================
  // getOptionPositions
  // ===========================================================================

  describe('getOptionPositions', () => {
    it('returns option positions with contract details', async () => {
      mockResolve({
        success: true,
        parsed: {
          results: [
            {
              instrument_id: 'opt-uuid-1',
              chain_symbol: 'AAPL',
              type: 'call',
              strike_price: '180.00',
              expiration_date: '2026-01-15',
              quantity: '2',
              average_cost: '320.00',
            },
          ],
        },
        redacted: {},
        tool: 'get_option_positions',
      });

      const positions = await client.getOptionPositions('123456789');

      expect(positions.length).toBe(1);
      expect(positions[0]).toEqual({
        instrumentId: 'opt-uuid-1',
        chainSymbol: 'AAPL',
        optionType: 'call',
        strikePrice: 180,
        expirationDate: '2026-01-15',
        quantity: 2,
        averageCost: 320,
      } satisfies OptionPosition);
    });

    it('passes nonzero=true when requested', async () => {
      mockResolve({
        success: true,
        parsed: { results: [] },
        redacted: {},
        tool: 'get_option_positions',
      });

      await client.getOptionPositions('123456789', true);

      expect(mcp.executeTool).toHaveBeenCalledWith('get_option_positions', { args: { account_number: '123456789', nonzero: true } });
    });

    it('omits nonzero when not specified', async () => {
      mockResolve({
        success: true,
        parsed: { results: [] },
        redacted: {},
        tool: 'get_option_positions',
      });

      await client.getOptionPositions('123456789');

      expect(mcp.executeTool).toHaveBeenCalledWith('get_option_positions', { args: { account_number: '123456789' } });
    });

    it('throws RobinhoodMcpError on failure', async () => {
      mockFailure('MCP timeout', ToolExecutionErrorCategory.MCP);

      try {
        await client.getOptionPositions('123456789');
        fail('Expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(RobinhoodMcpError);
        expect((err as RobinhoodMcpError).tool).toBe('get_option_positions');
      }
    });
  });

  // ===========================================================================
  // getEquityOrders
  // ===========================================================================

  describe('getEquityOrders', () => {
    it('returns normalized equity orders', async () => {
      mockResolve({
        success: true,
        parsed: {
          results: [
            {
              id: 'order-1',
              side: 'buy',
              type: 'market',
              state: 'filled',
              quantity: '10',
              cumulative_quantity: '10',
              price: '150.00',
              average_price: '149.95',
              created_at: '2026-01-15T10:00:00Z',
              symbol: 'AAPL',
            },
          ],
        },
        redacted: {},
        tool: 'get_equity_orders',
      });

      const orders = await client.getEquityOrders('123456789');

      expect(orders.length).toBe(1);
      expect(orders[0]).toEqual({
        orderId: 'order-1',
        accountNumber: '123456789',
        instrumentType: 'equity',
        symbol: 'AAPL',
        side: 'buy',
        type: 'market',
        state: 'filled',
        quantity: 10,
        cumulativeQuantity: 10,
        price: 150,
        stopPrice: null,
        averageFillPrice: 149.95,
        createdAt: '2026-01-15T10:00:00Z',
      } satisfies BrokerOrder);
    });

    it('passes state filter when provided', async () => {
      mockResolve({ success: true, parsed: { results: [] }, redacted: {}, tool: 'get_equity_orders' });

      await client.getEquityOrders('123456789', { state: 'filled' });

      expect(mcp.executeTool).toHaveBeenCalledWith('get_equity_orders', { args: { account_number: '123456789', state: 'filled' } });
    });

    it('throws RobinhoodMcpError on failure', async () => {
      mockFailure('Server error', ToolExecutionErrorCategory.MCP);

      try {
        await client.getEquityOrders('123456789');
        fail('Expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(RobinhoodMcpError);
        expect((err as RobinhoodMcpError).tool).toBe('get_equity_orders');
      }
    });

    it('skips orders with invalid side instead of failing the entire list', async () => {
      mockResolve({
        success: true,
        parsed: {
          results: [
            { id: 'good-order', side: 'buy', type: 'market', state: 'filled', symbol: 'AAPL', quantity: '10' },
            { id: 'bad-order', side: 'invalid', type: 'market', state: 'filled', symbol: 'GOOG' },
            { id: 'good-order-2', side: 'sell', type: 'limit', state: 'cancelled', symbol: 'NVDA', quantity: '5' },
          ],
        },
        redacted: {},
        tool: 'get_equity_orders',
      });

      const orders = await client.getEquityOrders('123456789');

      expect(orders.length).toBe(2);
      expect(orders[0].orderId).toBe('good-order');
      expect(orders[1].orderId).toBe('good-order-2');
    });
  });

  // ===========================================================================
  // getOptionOrders
  // ===========================================================================

  describe('getOptionOrders', () => {
    it('returns normalized option orders', async () => {
      mockResolve({
        success: true,
        parsed: {
          results: [
            {
              id: 'opt-order-1',
              side: 'sell',
              type: 'limit',
              state: 'confirmed',
              quantity: '1',
              cumulative_quantity: '0',
              price: '3.50',
              created_at: '2026-01-15T11:00:00Z',
              chain_symbol: 'AAPL',
              legs: [{ side: 'sell', option_id: 'opt-uuid-1', quantity: '1' }],
            },
          ],
        },
        redacted: {},
        tool: 'get_option_orders',
      });

      const orders = await client.getOptionOrders('123456789');

      expect(orders.length).toBe(1);
      expect(orders[0]).toEqual({
        orderId: 'opt-order-1',
        accountNumber: '123456789',
        instrumentType: 'option',
        symbol: 'AAPL',
        side: 'sell',
        type: 'limit',
        state: 'confirmed',
        quantity: 1,
        cumulativeQuantity: 0,
        price: 3.5,
        stopPrice: null,
        averageFillPrice: null,
        createdAt: '2026-01-15T11:00:00Z',
      } satisfies BrokerOrder);
    });

    it('throws RobinhoodMcpError on failure', async () => {
      mockFailure('MCP error', ToolExecutionErrorCategory.MCP);

      try {
        await client.getOptionOrders('123456789');
        fail('Expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(RobinhoodMcpError);
        expect((err as RobinhoodMcpError).tool).toBe('get_option_orders');
      }
    });

    it('skips orders with invalid side instead of failing the entire list', async () => {
      mockResolve({
        success: true,
        parsed: {
          results: [
            { id: 'good-opt', side: 'buy', type: 'market', state: 'filled', chain_symbol: 'AAPL', quantity: '1' },
            { id: 'bad-opt', side: 'invalid', type: 'market', state: 'filled', chain_symbol: 'GOOG' },
          ],
        },
        redacted: {},
        tool: 'get_option_orders',
      });

      const orders = await client.getOptionOrders('123456789');

      expect(orders.length).toBe(1);
      expect(orders[0].orderId).toBe('good-opt');
      expect(orders[0].symbol).toBe('AAPL');
    });
  });

  // ===========================================================================
  // getEquityQuotes
  // ===========================================================================

  describe('getEquityQuotes', () => {
    it('returns quotes keyed by symbol', async () => {
      mockResolve({
        success: true,
        parsed: {
          data: {
            quotes: [
              { symbol: 'AAPL', last_trade_price: '155.00', previous_close: '150.00' },
              { symbol: 'NVDA', last_trade_price: '810.00', previous_close: '800.00' },
            ],
          },
        },
        redacted: {},
        tool: 'get_equity_quotes',
      });

      const quotes = await client.getEquityQuotes(['AAPL', 'NVDA']);

      expect(quotes.size).toBe(2);
      expect(quotes.get('AAPL')).toEqual({
        symbol: 'AAPL',
        lastTradePrice: 155,
        previousClose: 150,
      } satisfies EquityQuote);
      expect(quotes.get('NVDA')!.lastTradePrice).toBe(810);
    });

    it('deduplicates symbols before fetching', async () => {
      mockResolve({
        success: true,
        parsed: { data: { quotes: [] } },
        redacted: {},
        tool: 'get_equity_quotes',
      });

      await client.getEquityQuotes(['AAPL', 'AAPL', 'NVDA']);

      expect(mcp.executeTool).toHaveBeenCalledTimes(1);
      const callArgs = mcp.executeTool.calls.mostRecent().args;
      const symbolsArg = (callArgs[1] as { args: { symbols: string[] } }).args.symbols;
      expect(symbolsArg).toEqual(['AAPL', 'NVDA']);
    });

    it('batches into chunks of 20 symbols', async () => {
      const symbols = Array.from({ length: 25 }, (_, i) => `SYM${i}`);
      mcp.executeTool.and.callFake((tool: string, req: { args: { symbols: string[] } }) => {
        const syms = req.args.symbols;
        const quotes = syms.map((s) => ({ symbol: s, last_trade_price: '100.00', previous_close: '99.00' }));
        return Promise.resolve({ success: true, parsed: { data: { quotes } }, redacted: {}, tool });
      });

      const quotes = await client.getEquityQuotes(symbols);

      expect(mcp.executeTool).toHaveBeenCalledTimes(2);
      expect(quotes.size).toBe(25);
    });

    it('handles quotes from { results: [...] } shape', async () => {
      mockResolve({
        success: true,
        parsed: {
          results: [
            { symbol: 'TSLA', last_trade_price: '250.00', previous_close: '245.00' },
          ],
        },
        redacted: {},
        tool: 'get_equity_quotes',
      });

      const quotes = await client.getEquityQuotes(['TSLA']);

      expect(quotes.get('TSLA')!.lastTradePrice).toBe(250);
    });

    it('returns empty map for empty symbols array', async () => {
      const quotes = await client.getEquityQuotes([]);

      expect(quotes.size).toBe(0);
      expect(mcp.executeTool).not.toHaveBeenCalled();
    });

    it('throws RobinhoodMcpError when a batch fails', async () => {
      mcp.executeTool.and.callFake(() => Promise.resolve({
        success: false,
        error: 'Quote fetch failed',
        category: ToolExecutionErrorCategory.MCP,
      }));

      try {
        await client.getEquityQuotes(['AAPL']);
        fail('Expected throw on batch failure');
      } catch (err) {
        expect(err).toBeInstanceOf(RobinhoodMcpError);
        expect((err as RobinhoodMcpError).tool).toBe('get_equity_quotes');
        expect((err as RobinhoodMcpError).message).toBe('Quote fetch failed');
      }
    });

    it('trims and filters empty symbols before fetching', async () => {
      mockResolve({
        success: true,
        parsed: { data: { quotes: [] } },
        redacted: {},
        tool: 'get_equity_quotes',
      });

      await client.getEquityQuotes(['  AAPL  ', '', '  ', 'NVDA']);

      expect(mcp.executeTool).toHaveBeenCalledTimes(1);
      const callArgs = mcp.executeTool.calls.mostRecent().args;
      const symbolsArg = (callArgs[1] as { args: { symbols: string[] } }).args.symbols;
      expect(symbolsArg).toEqual(['AAPL', 'NVDA']);
    });
  });

  // ===========================================================================
  // getOptionQuotes
  // ===========================================================================

  describe('getOptionQuotes', () => {
    it('returns quotes keyed by instrumentId', async () => {
      mockResolve({
        success: true,
        parsed: {
          data: {
            quotes: [
              { instrument_id: 'opt-uuid-1', last_trade_price: '3.50', previous_close: '3.00' },
            ],
          },
        },
        redacted: {},
        tool: 'get_option_quotes',
      });

      const quotes = await client.getOptionQuotes(['opt-uuid-1']);

      expect(quotes.size).toBe(1);
      expect(quotes.get('opt-uuid-1')).toEqual({
        instrumentId: 'opt-uuid-1',
        lastTradePrice: 3.5,
        previousClose: 3,
      } satisfies OptionQuote);
    });

    it('batches into chunks of 20 instrument IDs', async () => {
      const ids = Array.from({ length: 45 }, (_, i) => `opt-${i}`);
      mcp.executeTool.and.callFake((tool: string, req: { args: { instrument_ids: string[] } }) => {
        const batchIds = req.args.instrument_ids;
        const quotes = batchIds.map((id) => ({ instrument_id: id, last_trade_price: '1.00', previous_close: '1.00' }));
        return Promise.resolve({ success: true, parsed: { data: { quotes } }, redacted: {}, tool });
      });

      const quotes = await client.getOptionQuotes(ids);

      expect(mcp.executeTool).toHaveBeenCalledTimes(3);
      expect(quotes.size).toBe(45);
    });

    it('deduplicates instrument IDs before fetching', async () => {
      mockResolve({
        success: true,
        parsed: { data: { quotes: [] } },
        redacted: {},
        tool: 'get_option_quotes',
      });

      await client.getOptionQuotes(['opt-1', 'opt-1', 'opt-2']);

      expect(mcp.executeTool).toHaveBeenCalledTimes(1);
      const callArgs = mcp.executeTool.calls.mostRecent().args;
      const idsArg = (callArgs[1] as { args: { instrument_ids: string[] } }).args.instrument_ids;
      expect(idsArg).toEqual(['opt-1', 'opt-2']);
    });

    it('returns empty map for empty instrument IDs array', async () => {
      const quotes = await client.getOptionQuotes([]);

      expect(quotes.size).toBe(0);
      expect(mcp.executeTool).not.toHaveBeenCalled();
    });

    it('throws RobinhoodMcpError when a batch fails', async () => {
      mcp.executeTool.and.callFake(() => Promise.resolve({
        success: false,
        error: 'Option quote fetch failed',
        category: ToolExecutionErrorCategory.MCP,
      }));

      try {
        await client.getOptionQuotes(['opt-uuid-1']);
        fail('Expected throw on batch failure');
      } catch (err) {
        expect(err).toBeInstanceOf(RobinhoodMcpError);
        expect((err as RobinhoodMcpError).tool).toBe('get_option_quotes');
      }
    });
  });
});
