import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError } from 'rxjs';

import { OrderExecutionService } from './order-execution.service';
import { RobinhoodMcpObservationService } from '../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
import { ScreenshotService } from '../../dev-screenshot/screenshot.service';
import {
  OrderSource,
  OrderTicketStatus,
  InstrumentType,
  EquityOrderTicket,
  OptionOrderTicket,
} from './order-ticket.types';

describe('OrderExecutionService', () => {
  let service: OrderExecutionService;
  let mcpService: any;
  let rhClient: { getEquityOrders: jest.Mock };
  let screenshots: { captureChartSnapshot$: jasmine.Spy };

  function mockTicket(overrides: Partial<EquityOrderTicket> = {}): EquityOrderTicket {
    return {
      id: 'ticket-1',
      refId: 'ref-abc-123',
      source: OrderSource.SIGNAL_PIPELINE,
      status: OrderTicketStatus.SUBMITTING,
      accountNumber: '123456789',
      side: 'buy',
      orderType: 'market',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      instrumentType: InstrumentType.EQUITY,
      symbol: 'AAPL',
      quantity: '10',
      createdAt: '2026-08-25T12:00:00Z',
      updatedAt: '2026-08-25T12:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    mcpService = {
      executeTool: jasmine.createSpy('executeTool'),
    };
    // Default: the cancelled order confirms immediately.
    rhClient = {
      getEquityOrders: jest.fn().mockResolvedValue([
        { orderId: 'order-old', symbol: 'AAPL', state: 'cancelled', cumulativeQuantity: 0 },
      ]),
    };
    screenshots = {
      captureChartSnapshot$: jasmine.createSpy('captureChartSnapshot$').and.returnValue(
        of({ artifacts: [], paths: [] }),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: RobinhoodMcpObservationService, useValue: mcpService },
        { provide: RobinhoodMcpClient, useValue: rhClient },
        { provide: ScreenshotService, useValue: screenshots },
        OrderExecutionService,
      ],
    });

    service = TestBed.inject(OrderExecutionService);
  });

  describe('submitEquityOrder', () => {
    it('calls review_equity_order preflight then place_equity_order with ref_id', async () => {
      mcpService.executeTool.and.callFake((name: string) => {
        if (name === 'review_equity_order') {
          return Promise.resolve({ success: true, redacted: {}, tool: name });
        }
        if (name === 'place_equity_order') {
          return Promise.resolve({
            success: true,
            parsed: { id: 'order-123', state: 'confirmed', average_price: null, filled_quantity: '0' },
            redacted: {},
            tool: name,
          });
        }
        return Promise.resolve({ success: false, error: 'Unknown tool' });
      });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(true);
      expect(result.result?.orderId).toBe('order-123');
      expect(result.result?.state).toBe('confirmed');
      expect(mcpService.executeTool).toHaveBeenCalledTimes(2);
      // Verify ref_id is NOT in the review call args (preflight doesn't use idempotency)
      const reviewCall = mcpService.executeTool.calls.argsFor(0);
      expect(reviewCall[0]).toBe('review_equity_order');
      expect((reviewCall[1].args as any).ref_id).toBeUndefined();
      // Verify ref_id is in the place call args
      const placeCall = mcpService.executeTool.calls.argsFor(1);
      expect(placeCall[0]).toBe('place_equity_order');
      expect((placeCall[1].args as any).ref_id).toBe('ref-abc-123');
    });

    it('sends quantity instead of stale dollar amount when both are present', async () => {
      mcpService.executeTool.and.resolveTo({ success: true, parsed: {}, redacted: {}, tool: 'test' });

      await service.submitEquityOrder(mockTicket({ quantity: '3', dollarAmount: '500' }));

      const reviewArgs = mcpService.executeTool.calls.argsFor(0)[1].args;
      const placeArgs = mcpService.executeTool.calls.argsFor(1)[1].args;
      expect(reviewArgs.quantity).toBe('3');
      expect(reviewArgs.dollar_amount).toBeUndefined();
      expect(placeArgs.quantity).toBe('3');
      expect(placeArgs.dollar_amount).toBeUndefined();
    });

    it('returns failure when review preflight fails (retryable)', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Network timeout',
        category: 'MCP',
      });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
      expect(result.error?.message).toBe('Network timeout');
      // Should not have called place_equity_order
      expect(mcpService.executeTool).toHaveBeenCalledTimes(1);
    });

    it('returns non-retryable failure for insufficient buying power', async () => {
      mcpService.executeTool.and.callFake((name: string) => {
        if (name === 'review_equity_order') {
          return Promise.resolve({ success: true, redacted: {}, tool: name });
        }
        return Promise.resolve({
          success: false,
          error: 'Insufficient buying power for this order',
          category: 'MCP',
        });
      });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(result.error?.message).toContain('Insufficient buying power');
    });

    it('returns non-retryable failure for invalid symbol', async () => {
      mcpService.executeTool.and.callFake((name: string) => {
        if (name === 'review_equity_order') {
          return Promise.resolve({
            success: false,
            error: 'Invalid symbol: XYZABC',
            category: 'VALIDATION',
          });
        }
        return Promise.resolve({ success: true, redacted: {}, tool: name });
      });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(false);
    });

    it('returns retryable failure for network error on place', async () => {
      mcpService.executeTool.and.callFake((name: string) => {
        if (name === 'review_equity_order') {
          return Promise.resolve({ success: true, redacted: {}, tool: name });
        }
        if (name === 'place_equity_order') {
          return Promise.reject(new Error('Connection timed out'));
        }
        return Promise.resolve({ success: false, error: 'noop' });
      });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
      expect(result.error?.message).toContain('Connection timed out');
    });

    it('returns retryable failure for preflight exception', async () => {
      mcpService.executeTool.and.rejectWith(new Error('Network error'));

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
    });

    it('passes limit_price and stop_price for limit/stop orders', async () => {
      mcpService.executeTool.and.callFake((name: string) => {
        return Promise.resolve({
          success: true,
          parsed: { id: 'order-1', state: 'confirmed' },
          redacted: {},
          tool: name,
        });
      });

      const ticket = mockTicket({
        orderType: 'stop_limit',
        limitPrice: '150.00',
        stopPrice: '145.00',
      });

      await service.submitEquityOrder(ticket);

      const reviewArgs = mcpService.executeTool.calls.argsFor(0)[1].args;
      expect(reviewArgs.limit_price).toBe('150.00');
      expect(reviewArgs.stop_price).toBe('145.00');
      expect(reviewArgs.type).toBe('stop_limit');
    });

    it('fails retryable when the place response carries no order id', async () => {
      // A success envelope without a parseable order id must not surface as a
      // placed order — callers would persist an uncancellable phantom.
      mcpService.executeTool.and.callFake((name: string) => {
        return Promise.resolve({ success: true, parsed: {}, redacted: {}, tool: name });
      });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
      expect(result.error?.message).toContain('no order id');
      expect(result.result).toBeUndefined();
    });

    it('fails non-retryable when the place response reports a dead order state', async () => {
      // An order that exists but lands terminal (e.g. rejected) is not a live
      // resting order — reporting success would claim protection that isn't.
      mcpService.executeTool.and.callFake((name: string) => {
        if (name === 'place_equity_order') {
          return Promise.resolve({
            success: true,
            parsed: { id: 'order-dead', symbol: 'AAPL', state: 'rejected' },
            redacted: {},
            tool: name,
          });
        }
        return Promise.resolve({ success: true, parsed: {}, redacted: {}, tool: name });
      });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(result.error?.message).toContain('rejected');
      expect(result.result?.orderId).toBe('order-dead');
    });
  });

  describe('submitOptionOrder', () => {
    function mockOptionTicket(overrides: Partial<OptionOrderTicket> = {}): OptionOrderTicket {
      return {
        id: 'opt-ticket-1',
        refId: 'ref-opt-1',
        source: OrderSource.SIGNAL_PIPELINE,
        status: OrderTicketStatus.SUBMITTING,
        accountNumber: '123456789',
        side: 'buy',
        orderType: 'limit',
        timeInForce: 'gfd',
        marketHours: 'regular_hours',
        instrumentType: InstrumentType.OPTION,
        symbol: 'AAPL',
        legs: [
          { side: 'buy', symbol: 'AAPL251016C00150000', optionId: 'opt-uuid-1', positionEffect: 'open' },
        ],
        quantity: '2',
        price: '3.50',
        createdAt: '2026-08-25T12:00:00Z',
        updatedAt: '2026-08-25T12:00:00Z',
        ...overrides,
      };
    }

    function placeOptionSuccess(parsed: unknown = { id: 'opt-order-1', state: 'confirmed' }) {
      mcpService.executeTool.and.callFake((name: string) => {
        if (name === 'place_option_order') {
          return Promise.resolve({ success: true, parsed, redacted: {}, tool: name });
        }
        return Promise.resolve({ success: true, parsed: {}, redacted: {}, tool: name });
      });
    }

    it('calls review_option_order preflight then place_option_order with the RH leg shape', async () => {
      placeOptionSuccess();

      const result = await service.submitOptionOrder(mockOptionTicket());

      expect(result.success).toBe(true);
      expect(result.result?.orderId).toBe('opt-order-1');
      expect(result.result?.state).toBe('confirmed');
      expect(mcpService.executeTool).toHaveBeenCalledTimes(2);

      const reviewCall = mcpService.executeTool.calls.argsFor(0);
      expect(reviewCall[0]).toBe('review_option_order');
      expect(reviewCall[1].args).toEqual({
        account_number: '123456789',
        legs: [{ option_id: 'opt-uuid-1', side: 'buy', position_effect: 'open' }],
        type: 'limit',
        quantity: '2',
        price: '3.50',
        time_in_force: 'gfd',
        market_hours: 'regular_hours',
      });
      // Single-leg: direction is derived, never sent; ref_id is place-only.
      expect((reviewCall[1].args as any).direction).toBeUndefined();
      expect((reviewCall[1].args as any).ref_id).toBeUndefined();

      const placeCall = mcpService.executeTool.calls.argsFor(1);
      expect(placeCall[0]).toBe('place_option_order');
      expect(placeCall[1].args).toEqual({ ...reviewCall[1].args, ref_id: 'ref-opt-1' });
    });

    it('rejects an unplaceable ticket before any tool call', async () => {
      const cases: Partial<OptionOrderTicket>[] = [
        { quantity: '' },
        { quantity: '2.5' },            // RH requires integer contracts
        { legs: [] },
        { legs: [mockOptionTicket().legs[0], mockOptionTicket().legs[0]] }, // v1 single-leg; RH rejects multi-leg live
        { price: undefined },           // limit without a price
        { orderType: 'stop_limit', price: '3.50', stopPrice: undefined }, // stop type without stop price
        { orderType: 'market', price: undefined, timeInForce: 'gtc' },    // market must be gfd
      ];
      for (const overrides of cases) {
        const result = await service.submitOptionOrder(mockOptionTicket(overrides));
        expect(result.success).toBe(false);
        expect(result.error?.retryable).toBe(false);
      }
      expect(mcpService.executeTool).not.toHaveBeenCalled();
    });

    it('sends both price and stop_price on stop_limit; stop_loss maps to stop_market', async () => {
      placeOptionSuccess();

      await service.submitOptionOrder(
        mockOptionTicket({ orderType: 'stop_limit', price: '3.50', stopPrice: '3.75' }),
      );
      const stopLimitArgs = mcpService.executeTool.calls.argsFor(0)[1].args;
      expect(stopLimitArgs.type).toBe('stop_limit');
      expect(stopLimitArgs.price).toBe('3.50');
      expect(stopLimitArgs.stop_price).toBe('3.75');

      mcpService.executeTool.calls.reset();
      await service.submitOptionOrder(
        mockOptionTicket({ orderType: 'stop_loss', stopPrice: '3.00', price: undefined }),
      );
      const stopLossArgs = mcpService.executeTool.calls.argsFor(0)[1].args;
      expect(stopLossArgs.type).toBe('stop_market');
      expect(stopLossArgs.stop_price).toBe('3.00');
      expect(stopLossArgs.price).toBeUndefined();
    });

    it('omits price for a market option order', async () => {
      placeOptionSuccess();

      await service.submitOptionOrder(mockOptionTicket({ orderType: 'market', price: undefined }));

      const reviewArgs = mcpService.executeTool.calls.argsFor(0)[1].args;
      expect(reviewArgs.type).toBe('market');
      expect(reviewArgs.price).toBeUndefined();
      expect(mcpService.executeTool.calls.argsFor(1)[1].args.price).toBeUndefined();
    });

    it('returns failure when the option review preflight errors — place never runs', async () => {
      mcpService.executeTool.and.resolveTo({ success: false, error: 'insufficient buying power', tool: 'review_option_order' });

      const result = await service.submitOptionOrder(mockOptionTicket());

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(mcpService.executeTool).toHaveBeenCalledTimes(1);
    });

    it('treats a place_option_order toolError envelope as classified failure', async () => {
      mcpService.executeTool.and.callFake((name: string) => {
        if (name === 'place_option_order') {
          return Promise.resolve({
            success: true,
            toolError: 'account not agentic_allowed for options',
            redacted: {},
            tool: name,
          });
        }
        return Promise.resolve({ success: true, parsed: {}, redacted: {}, tool: name });
      });

      const result = await service.submitOptionOrder(mockOptionTicket());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('agentic_allowed');
      expect(result.error?.retryable).toBe(false);
    });

    it('fails retryable PLACEMENT_UNCONFIRMED when the place response carries no order id', async () => {
      placeOptionSuccess({ legs: [{ option_id: 'opt-uuid-1' }] });

      const result = await service.submitOptionOrder(mockOptionTicket());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PLACEMENT_UNCONFIRMED');
      expect(result.error?.retryable).toBe(true);
    });

    it('parses option fill fields — processed_quantity drives the dead-with-fills branch', async () => {
      placeOptionSuccess({ id: 'opt-dead-fill', state: 'cancelled', processed_quantity: '1.00000' });

      const result = await service.submitOptionOrder(mockOptionTicket());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PLACEMENT_DEAD');
      expect(result.result?.filledQuantity).toBe('1.00000');
      expect(result.error?.message).toContain('with 1 filled');
    });

    it('fails non-retryable PLACEMENT_DEAD when the placed option order lands terminal', async () => {
      placeOptionSuccess({ id: 'opt-order-dead', state: 'rejected' });

      const result = await service.submitOptionOrder(mockOptionTicket());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PLACEMENT_DEAD');
      expect(result.error?.retryable).toBe(false);
      expect(result.result?.orderId).toBe('opt-order-dead');
    });

    it('fails retryable PLACEMENT_UNCONFIRMED on an unrecognized state', async () => {
      placeOptionSuccess({ id: 'opt-order-x', state: 'mystery' });

      const result = await service.submitOptionOrder(mockOptionTicket());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PLACEMENT_UNCONFIRMED');
      expect(result.result?.orderId).toBe('opt-order-x');
    });

    it('parses a data.order-nested option place response', async () => {
      placeOptionSuccess({ data: { order: { id: 'opt-nested-1', state: 'confirmed' } } });

      const result = await service.submitOptionOrder(mockOptionTicket());

      expect(result.success).toBe(true);
      expect(result.result?.orderId).toBe('opt-nested-1');
    });

    it('fires a chart capture with the option-single position type on a confirmed order', async () => {
      placeOptionSuccess();

      const result = await service.submitOptionOrder(mockOptionTicket());

      expect(result.success).toBe(true);
      expect(screenshots.captureChartSnapshot$).toHaveBeenCalledWith({
        symbol: 'AAPL',
        event: 'order-placed',
        positionType: 'option-single',
        refId: 'ref-opt-1',
        groupId: 'ref-opt-1',
        renderOnly: false,
      });
    });
  });

  describe('screenshot capture (#746)', () => {
    function placeSuccess(state: string) {
      mcpService.executeTool.and.callFake((name: string) => {
        if (name === 'place_equity_order') {
          return Promise.resolve({
            success: true,
            parsed: { id: 'order-123', symbol: 'AAPL', state },
            redacted: {},
            tool: name,
          });
        }
        return Promise.resolve({ success: true, parsed: {}, redacted: {}, tool: name });
      });
    }

    it('fires an order-placed capture on a confirmed resting order', async () => {
      placeSuccess('confirmed');

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(true);
      expect(screenshots.captureChartSnapshot$).toHaveBeenCalledWith({
        symbol: 'AAPL',
        event: 'order-placed',
        positionType: 'stock',
        refId: 'ref-abc-123',
        groupId: 'ref-abc-123',
        renderOnly: false,
      });
    });

    it('fires an order-filled capture on a synchronous market fill', async () => {
      placeSuccess('filled');

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(true);
      expect(screenshots.captureChartSnapshot$).toHaveBeenCalledWith(
        jasmine.objectContaining({ event: 'order-filled' }),
      );
    });

    it('does not capture when the placement fails', async () => {
      mcpService.executeTool.and.resolveTo({ success: false, error: 'rejected', tool: 'place_equity_order' });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(false);
      expect(screenshots.captureChartSnapshot$).not.toHaveBeenCalled();
    });

    it('swallows capture errors — the order result is unaffected', async () => {
      placeSuccess('confirmed');
      screenshots.captureChartSnapshot$.and.returnValue(
        throwError(() => new Error('bucket down')),
      );

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.success).toBe(true);
      expect(result.result?.orderId).toBe('order-123');
    });
  });

  describe('cancelEquityOrder', () => {
    it('calls cancel_equity_order with account_number and order_id', async () => {
      mcpService.executeTool.and.resolveTo({ success: true, redacted: {}, tool: 'cancel_equity_order' });

      const result = await service.cancelEquityOrder('123456789', 'order-456');

      expect(result.success).toBe(true);
      expect(mcpService.executeTool).toHaveBeenCalledWith('cancel_equity_order', {
        args: { account_number: '123456789', order_id: 'order-456' },
      });
    });

    it('returns failure when cancel fails (non-retryable for already filled)', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Order already filled',
        category: 'MCP',
      });

      const result = await service.cancelEquityOrder('123456789', 'order-456');

      expect(result.success).toBe(false);
      // Terminal order states are non-retryable — the cancel can never succeed.
      expect(result.error?.retryable).toBe(false);
    });

    it('treats an isError envelope inside a successful transport result as failure', async () => {
      // Captured RH shape (err-cancel-bad-order): tool-level rejections arrive
      // as success:true with an isError envelope — cancel must not report success.
      mcpService.executeTool.and.resolveTo({
        success: true,
        toolError: 'API error 404: {"detail":"Not found."}',
        redacted: {},
      });

      const result = await service.cancelEquityOrder('123456789', 'order-456');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Not found');
      expect(result.error?.retryable).toBe(false);
    });

    it('returns retryable failure on network exception', async () => {
      mcpService.executeTool.and.rejectWith(new Error('Connection refused'));

      const result = await service.cancelEquityOrder('123456789', 'order-456');

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
    });
  });

  describe('updateEquityStopOrder', () => {
    let toolCalls: { name: string; args: Record<string, unknown> }[];

    function stopTicket(overrides: Partial<EquityOrderTicket> = {}): EquityOrderTicket {
      return mockTicket({
        side: 'sell',
        orderType: 'stop_loss',
        stopPrice: '150.00',
        quantity: '25',
        timeInForce: 'gtc',
        ...overrides,
      });
    }

    /** Wire executeTool: cancel + review succeed; place/cancel behavior is per-test. */
    function mockTools(place: () => Promise<unknown>, opts: { cancel?: () => Promise<unknown>; cancelError?: string } = {}) {
      toolCalls = [];
      mcpService.executeTool = jest.fn((name: string, req: { args: Record<string, unknown> }) => {
        toolCalls.push({ name, args: req?.args ?? {} });
        if (name === 'cancel_equity_order') {
          if (opts.cancel) return opts.cancel();
          return opts.cancelError
            ? Promise.resolve({ success: false, error: opts.cancelError })
            : Promise.resolve({ success: true, redacted: {} });
        }
        if (name === 'review_equity_order') {
          return Promise.resolve({ success: true, redacted: {} });
        }
        if (name === 'place_equity_order') {
          return place();
        }
        return Promise.resolve({ success: false, error: `unexpected tool ${name}` });
      });
    }

    const placeOk = () => Promise.resolve({
      success: true,
      parsed: { id: 'order-new', state: 'confirmed', symbol: 'AAPL' },
      redacted: {},
    });

    it('cancels the existing order then submits the replacement ticket', async () => {
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(true);
      expect(result.result?.orderId).toBe('order-new');
      expect(result.phase).toBeUndefined();
      expect(result.unprotected).toBeUndefined();
      expect(toolCalls[0].name).toBe('cancel_equity_order');
      expect(toolCalls[0].args).toEqual({ account_number: '123456789', order_id: 'order-old' });
      expect(toolCalls[1].name).toBe('review_equity_order');
      expect(toolCalls[2].name).toBe('place_equity_order');
      expect(toolCalls[2].args['ref_id']).toBe('ref-abc-123');
    });

    it('does not attempt review/place when cancel fails — phase cancel, still protected', async () => {
      mockTools(placeOk, { cancelError: 'Order already filled' });

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.message).toBe('Order already filled');
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('retries a retryable place error up to 3 attempts reusing the same refId', async () => {
      mockTools(() => Promise.resolve({ success: false, error: 'Network timeout' }));

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(true);
      expect(result.error?.message).toBe('Network timeout');
      const placeCalls = toolCalls.filter(c => c.name === 'place_equity_order');
      expect(placeCalls).toHaveLength(3);
      for (const call of placeCalls) {
        expect(call.args['ref_id']).toBe('ref-abc-123');
      }
    }, 10000);

    it('succeeds when a retryable place error recovers on retry', async () => {
      let attempts = 0;
      mockTools(() => {
        attempts++;
        return attempts === 1
          ? Promise.resolve({ success: false, error: 'Connection timeout' })
          : placeOk();
      });

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(true);
      expect(result.result?.orderId).toBe('order-new');
      const placeCalls = toolCalls.filter(c => c.name === 'place_equity_order');
      expect(placeCalls).toHaveLength(2);
    }, 10000);

    it('does not retry a non-retryable place error — phase place, unprotected', async () => {
      mockTools(() => Promise.resolve({ success: false, error: 'Insufficient buying power' }));

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(true);
      expect(result.error?.retryable).toBe(false);
      const placeCalls = toolCalls.filter(c => c.name === 'place_equity_order');
      expect(placeCalls).toHaveLength(1);
    });

    it('surfaces cancel-phase failure when cancel throws', async () => {
      mockTools(placeOk, { cancel: () => Promise.reject(new Error('Connection refused')) });

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('does not place when cancel returns a tool-level isError envelope', async () => {
      // Captured RH shape (err-cancel-bad-order): a rejected cancel can arrive
      // as success:true carrying the isError envelope — must not double-stop.
      mockTools(placeOk, {
        cancel: () => Promise.resolve({
          success: true,
          toolError: 'API error 404: {"detail":"Not found."}',
          redacted: {},
        }),
      });

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('treats a place-phase toolError envelope as failure, not success', async () => {
      mockTools(() => Promise.resolve({
        success: true,
        toolError: 'API error 400: {"detail":"Insufficient buying power."}',
        redacted: {},
      }));

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(true);
      expect(toolCalls.filter(c => c.name === 'place_equity_order')).toHaveLength(1);
    });

    it('reports unprotected:false on a ref_id conflict — the replacement likely exists', async () => {
      // Captured RH behavior (mx-buy-lim-bid-409-refid): ref_id dedupe is a 409,
      // which can only occur if an earlier attempt with this refId was registered.
      mockTools(() => Promise.resolve({
        success: false,
        error: 'API error 409: {"detail":"Reference ID must be unique."}',
      }));

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(toolCalls.filter(c => c.name === 'place_equity_order')).toHaveLength(1);
    });

    it('stops retrying when a non-retryable error follows a retryable one', async () => {
      let attempts = 0;
      mockTools(() => {
        attempts++;
        return attempts === 1
          ? Promise.resolve({ success: false, error: 'Network timeout' })
          : Promise.resolve({ success: false, error: 'Insufficient buying power' });
      });

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(true);
      expect(toolCalls.filter(c => c.name === 'place_equity_order')).toHaveLength(2);
    }, 10000);

    it('rejects an accountNumber that does not match the ticket before touching the broker', async () => {
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket({
        accountNumber: 'OTHER-ACCOUNT',
      }));

      expect(result.success).toBe(false);
      // No broker phase ran — phase is absent rather than claiming 'cancel' failed.
      expect(result.phase).toBeUndefined();
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(toolCalls).toHaveLength(0);
      expect(rhClient.getEquityOrders).not.toHaveBeenCalled();
    });

    it('polls order state until the accepted cancel is confirmed before placing', async () => {
      rhClient.getEquityOrders
        .mockResolvedValueOnce([{ orderId: 'order-old', state: 'pending_cancelled' }])
        .mockResolvedValue([{ orderId: 'order-old', state: 'cancelled', cumulativeQuantity: 0 }]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(true);
      expect(rhClient.getEquityOrders).toHaveBeenCalledTimes(2);
      expect(rhClient.getEquityOrders).toHaveBeenCalledWith('123456789', { orderId: 'order-old' });
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order', 'review_equity_order', 'place_equity_order']);
    }, 10000);

    it('aborts when the old order filled before the cancel completed', async () => {
      // RH cancel is async — a stop that fills in the race means the position
      // exited; placing the replacement could oversell.
      rhClient.getEquityOrders.mockResolvedValue([{ orderId: 'order-old', state: 'filled' }]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(result.error?.message).toContain('filled');
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('does not place while the cancel remains unconfirmed — reports place-phase unprotected', async () => {
      // Cancel was accepted but never confirmed: the old order is past the
      // point of return, so this is a place-phase failure (re-place the
      // ticket, never re-cancel) and the position is likely bare.
      rhClient.getEquityOrders.mockResolvedValue([{ orderId: 'order-old', state: 'confirmed' }]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(true);
      expect(result.error?.retryable).toBe(true);
      expect(result.error?.message).toContain('not confirmed cancelled');
      expect(rhClient.getEquityOrders).toHaveBeenCalledTimes(3);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    }, 10000);

    it('does not place when the order is absent from the list (order_id miss)', async () => {
      rhClient.getEquityOrders.mockResolvedValue([]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(true);
      expect(result.error?.retryable).toBe(true);
      expect(rhClient.getEquityOrders).toHaveBeenCalledWith('123456789', { orderId: 'order-old' });
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    }, 10000);

    it('classifies the captured terminal cancel rejection as non-retryable', async () => {
      // Captured live (mx-can-bid-403-filled): "Order cannot be cancelled at this time."
      mockTools(placeOk, { cancelError: 'API error 403: {"detail":"Order cannot be cancelled at this time."}' });

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
      expect(rhClient.getEquityOrders).not.toHaveBeenCalled();
    });

    it('does not place when the cancel rejection arrives as a redacted isError envelope', async () => {
      // Wire shape when the error text is NOT JSON: success:true, no toolError —
      // the raw isError envelope survives into `redacted`.
      mockTools(placeOk, {
        cancel: () => Promise.resolve({
          success: true,
          redacted: {
            isError: true,
            content: [{ type: 'text', text: 'API error 404: {"detail":"Not found."}' }],
          },
        }),
      });

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('does not place when the cancel rejection arrives as a parsed isError envelope', async () => {
      // Same envelope, JSON-parseable branch: carried under `parsed` instead of `redacted`.
      mockTools(placeOk, {
        cancel: () => Promise.resolve({
          success: true,
          parsed: {
            isError: true,
            content: [{ type: 'text', text: 'API error 404: {"detail":"Not found."}' }],
          },
          redacted: {},
        }),
      });

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('keeps polling when a state fetch fails, then fails retryable if still unconfirmed', async () => {
      // A transient get_equity_orders failure must not abort the confirmation —
      // the cancel was already accepted.
      rhClient.getEquityOrders
        .mockRejectedValueOnce(new Error('MCP session not found'))
        .mockResolvedValue([{ orderId: 'order-old', state: 'confirmed' }]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(true);
      expect(result.error?.retryable).toBe(true);
      expect(result.error?.message).toContain('session not found');
      expect(rhClient.getEquityOrders).toHaveBeenCalledTimes(3);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    }, 10000);

    it('aborts non-retryably when the order partially filled before the cancel landed', async () => {
      // cumulativeQuantity > 0 means the position shrank — the replacement
      // ticket carries the original quantity and would oversell.
      rhClient.getEquityOrders.mockResolvedValue([
        { orderId: 'order-old', state: 'partially_filled', cumulativeQuantity: 1 },
      ]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(result.error?.message).toContain('partially filled');
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('aborts non-retryably when a cancelled order carried fills', async () => {
      rhClient.getEquityOrders.mockResolvedValue([
        { orderId: 'order-old', state: 'cancelled', cumulativeQuantity: 2 },
      ]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.error?.retryable).toBe(false);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('confirms the cancel on partially_filled_rest_cancelled with zero fills', async () => {
      // RH terminal state when a partially-filled order's remainder is
      // cancelled — zero cumulative fills means the position is intact.
      rhClient.getEquityOrders.mockResolvedValue([
        { orderId: 'order-old', state: 'partially_filled_rest_cancelled', cumulativeQuantity: 0 },
      ]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(true);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order', 'review_equity_order', 'place_equity_order']);
    });

    it('confirms the cancel when the order lands in a non-cancelled terminal state', async () => {
      // rejected/failed/voided all mean the old order is definitively gone.
      rhClient.getEquityOrders.mockResolvedValue([{ orderId: 'order-old', state: 'rejected' }]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(true);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order', 'review_equity_order', 'place_equity_order']);
    });

    it('aborts on partially_filled_rest_cancelled when cumulative_quantity is absent', async () => {
      // The state name asserts fills happened; a missing field is ambiguous —
      // do not assume zero fills and place the original quantity.
      rhClient.getEquityOrders.mockResolvedValue([
        { orderId: 'order-old', state: 'partially_filled_rest_cancelled', cumulativeQuantity: null },
      ]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.error?.retryable).toBe(false);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('aborts on a plain cancelled order when cumulative_quantity is absent', async () => {
      // Same ambiguity as rest-cancelled — cancelled-with-fills is real, and
      // a missing field is not proof of zero fills.
      rhClient.getEquityOrders.mockResolvedValue([
        { orderId: 'order-old', state: 'cancelled', cumulativeQuantity: null },
      ]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.error?.retryable).toBe(false);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('aborts on a cancelled order that recorded executions', async () => {
      rhClient.getEquityOrders.mockResolvedValue([
        {
          orderId: 'order-old',
          state: 'cancelled',
          cumulativeQuantity: 0,
          executions: [{ price: 100, quantity: 1, timestamp: 't' }],
        },
      ]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.error?.retryable).toBe(false);
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('fails the cancel phase when the broker explicitly does not accept the cancel', async () => {
      // accepted:false means refused — the old order may still be live;
      // do NOT enter the confirm-poll/place path.
      mockTools(placeOk, {
        cancel: () => Promise.resolve({
          success: true,
          parsed: { data: { accepted: false } },
          redacted: {},
        }),
      });

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(rhClient.getEquityOrders).not.toHaveBeenCalled();
      expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order']);
    });

    it('treats an unrecognized place-response state as unconfirmed and converges on reconcile', async () => {
      // A registered order with a state outside the live/dead sets is
      // ambiguous — never a phantom success; the same-refId retry converges.
      mockTools(() => Promise.resolve({
        success: true,
        parsed: { id: 'order-weird', symbol: 'AAPL', state: 'received' },
        redacted: {},
      }));

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(false);
      expect(result.error?.code).toBe('PLACEMENT_UNCONFIRMED');
      expect(result.error?.message).toContain('unrecognized state');
      // Unconfirmed is retryable — all 3 attempts burn, then converge
      // unprotected:false because the order may exist broker-side.
      expect(toolCalls.filter(c => c.name === 'place_equity_order')).toHaveLength(3);
    }, 10000);

    it('does not retry a thrown exception carrying a ref-id conflict', async () => {
      // A transport-thrown 409 is still an identity error — safe to classify
      // non-retryable on the throw path too.
      let attempts = 0;
      mockTools(() => {
        attempts++;
        return attempts === 1
          ? Promise.reject(new Error('API error 409: {"detail":"Reference ID must be unique."}'))
          : Promise.reject(new Error('network timeout'));
      });

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(toolCalls.filter(c => c.name === 'place_equity_order')).toHaveLength(1);
    });

    it('reports unprotected:true with the dead order id when the replacement lands terminal', async () => {
      // The old stop is confirmed gone AND the replacement registered dead —
      // the position is bare; the dead order id is forwarded for reconcile.
      mockTools(() => Promise.resolve({
        success: true,
        parsed: { id: 'order-dead', symbol: 'AAPL', state: 'rejected' },
        redacted: {},
      }));

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(true);
      expect(result.error?.retryable).toBe(false);
      expect(result.error?.code).toBe('PLACEMENT_DEAD');
      expect(result.error?.message).toContain('fresh ticket');
      expect(result.result?.orderId).toBe('order-dead');
      // Non-retryable → single place attempt.
      expect(toolCalls.filter(c => c.name === 'place_equity_order')).toHaveLength(1);
    });

    it('aborts refresh-first when the dead replacement carried fills', async () => {
      // cancelled-with-fills means the position shrank — re-placing the
      // original ticket quantity would oversell; same contract as a
      // fill-during-cancel abort.
      mockTools(() => Promise.resolve({
        success: true,
        parsed: { id: 'order-dead', symbol: 'AAPL', state: 'cancelled', filled_quantity: '1', cumulative_quantity: '1' },
        redacted: {},
      }));

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(result.error?.message).toContain('partially filled then died');
      expect(result.result?.orderId).toBe('order-dead');
      expect(toolCalls.filter(c => c.name === 'place_equity_order')).toHaveLength(1);
    });

    it('aborts refresh-first when a fill-capable dead state omits fill fields', async () => {
      // cancelled with no fill fields is ambiguous (cancelled-with-fills is
      // real) — same rule as the cancel-confirm path; do not assume zero.
      mockTools(() => Promise.resolve({
        success: true,
        parsed: { id: 'order-dead', symbol: 'AAPL', state: 'cancelled' },
        redacted: {},
      }));

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(result.error?.message).toContain('fill state unknown');
      expect(result.result?.orderId).toBe('order-dead');
    });

    it('detects dead-with-fills via cumulative_quantity on the direct parse path', async () => {
      // Shape drift (missing symbol) forces the direct fallback — fills must
      // still be read from the verified cumulative_quantity wire key.
      mockTools(() => Promise.resolve({
        success: true,
        parsed: { id: 'order-dead', state: 'cancelled', cumulative_quantity: '2' },
        redacted: {},
      }));

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.message).toContain('partially filled then died');
    });

    it('treats a synchronously-filled replacement as position-exited, not success', async () => {
      // The replacement filled on placement — the position is gone and there
      // is no live stop; reporting success would claim protection.
      mockTools(() => Promise.resolve({
        success: true,
        parsed: { id: 'order-filled', symbol: 'AAPL', state: 'filled' },
        redacted: {},
      }));

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('cancel');
      expect(result.unprotected).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(result.result?.orderId).toBe('order-filled');
      expect(toolCalls.filter(c => c.name === 'place_equity_order')).toHaveLength(1);
    });

    it('exhausts on repeated unconfirmed place acks — unprotected:false, not a bare-position report', async () => {
      // Every place attempt returns a success envelope with no order id and
      // no 409 follows — the orders may exist; report unprotected:false so the
      // caller reconciles rather than re-places a duplicate.
      mockTools(() => Promise.resolve({ success: true, parsed: {}, redacted: {} }));

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(false);
      expect(result.error?.code).toBe('PLACEMENT_UNCONFIRMED');
      expect(toolCalls.filter(c => c.name === 'place_equity_order')).toHaveLength(3);
    }, 10000);

    it('confirms on the last poll when the cancel lands at the budget edge', async () => {
      rhClient.getEquityOrders
        .mockResolvedValueOnce([{ orderId: 'order-old', state: 'pending_cancelled' }])
        .mockResolvedValueOnce([{ orderId: 'order-old', state: 'pending_cancelled' }])
        .mockResolvedValue([{ orderId: 'order-old', state: 'cancelled', cumulativeQuantity: 0 }]);
      mockTools(placeOk);

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(true);
      expect(rhClient.getEquityOrders).toHaveBeenCalledTimes(3);
    }, 10000);

    it('converges on unprotected:false when an unconfirmed place is followed by a ref_id 409', async () => {
      // Attempt 1 returns a success envelope with no order id; attempt 2's
      // resubmit of the same refId gets the 409 — proof the first landed.
      let attempts = 0;
      mockTools(() => {
        attempts++;
        return attempts === 1
          ? Promise.resolve({ success: true, parsed: {}, redacted: {} })
          : Promise.resolve({ success: false, error: 'API error 409: {"detail":"Reference ID must be unique."}' });
      });

      const result = await service.updateEquityStopOrder('123456789', 'order-old', stopTicket());

      expect(result.success).toBe(false);
      expect(result.phase).toBe('place');
      expect(result.unprotected).toBe(false);
      expect(toolCalls.filter(c => c.name === 'place_equity_order')).toHaveLength(2);
    }, 10000);

    describe('replaceEquityOrder (generalized form)', () => {
      it('runs the same cancel → confirm → place flow for a generic order', async () => {
        mockTools(placeOk);

        const result = await service.replaceEquityOrder(
          '123456789', 'order-old', stopTicket(), 'order',
        );

        expect(result.success).toBe(true);
        expect(result.result?.orderId).toBe('order-new');
        expect(toolCalls.map(c => c.name)).toEqual(['cancel_equity_order', 'review_equity_order', 'place_equity_order']);
      });

      it('labels fill-adjacent messages with the order noun', async () => {
        mockTools(() => Promise.resolve({
          success: true,
          parsed: { id: 'order-filled', symbol: 'AAPL', state: 'filled' },
          redacted: {},
        }));

        const result = await service.replaceEquityOrder(
          '123456789', 'order-old', stopTicket(), 'order',
        );

        expect(result.error?.message).toContain('replacement order order-filled filled immediately');
      });

      it('defaults the noun to stop (updateEquityStopOrder delegate behavior)', async () => {
        mockTools(() => Promise.resolve({
          success: true,
          parsed: { id: 'order-filled', symbol: 'AAPL', state: 'filled' },
          redacted: {},
        }));

        const result = await service.replaceEquityOrder('123456789', 'order-old', stopTicket());

        expect(result.error?.message).toContain('replacement stop order-filled filled immediately');
      });
    });
  });

  describe('error classification', () => {
    it('classifies PDT violation as non-retryable', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Pattern day trader rule violation',
        category: 'MCP',
      });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.error?.retryable).toBe(false);
    });

    it('classifies rate limit as retryable', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Rate limit exceeded',
        category: 'MCP',
      });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.error?.retryable).toBe(true);
    });

    it('classifies non-agentic account as non-retryable', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Account is not agentic_allowed',
        category: 'AUTH',
      });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.error?.retryable).toBe(false);
    });

    it('defaults unknown errors to retryable', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Some unknown error',
        category: 'UNKNOWN',
      });

      const result = await service.submitEquityOrder(mockTicket());

      expect(result.error?.retryable).toBe(true);
    });
  });
});
