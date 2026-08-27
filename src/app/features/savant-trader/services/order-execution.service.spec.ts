import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { OrderExecutionService } from './order-execution.service';
import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';
import {
  OrderSource,
  OrderIntentStatus,
  InstrumentType,
  EquityOrderIntent,
} from './order-intent.types';

describe('OrderExecutionService', () => {
  let service: OrderExecutionService;
  let mcpService: any;

  function mockIntent(overrides: Partial<EquityOrderIntent> = {}): EquityOrderIntent {
    return {
      id: 'intent-1',
      refId: 'ref-abc-123',
      source: OrderSource.SIGNAL_PIPELINE,
      status: OrderIntentStatus.SUBMITTING,
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

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: RobinhoodMcpObservationService, useValue: mcpService },
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

      const result = await service.submitEquityOrder(mockIntent());

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

      await service.submitEquityOrder(mockIntent({ quantity: '3', dollarAmount: '500' }));

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

      const result = await service.submitEquityOrder(mockIntent());

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

      const result = await service.submitEquityOrder(mockIntent());

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

      const result = await service.submitEquityOrder(mockIntent());

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

      const result = await service.submitEquityOrder(mockIntent());

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
      expect(result.error?.message).toContain('Connection timed out');
    });

    it('returns retryable failure for preflight exception', async () => {
      mcpService.executeTool.and.rejectWith(new Error('Network error'));

      const result = await service.submitEquityOrder(mockIntent());

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

      const intent = mockIntent({
        orderType: 'stop_limit',
        limitPrice: '150.00',
        stopPrice: '145.00',
      });

      await service.submitEquityOrder(intent);

      const reviewArgs = mcpService.executeTool.calls.argsFor(0)[1].args;
      expect(reviewArgs.limit_price).toBe('150.00');
      expect(reviewArgs.stop_price).toBe('145.00');
      expect(reviewArgs.type).toBe('stop_limit');
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
      // "Order already filled" is not in non-retryable patterns, defaults to retryable
      expect(result.error?.retryable).toBe(true);
    });

    it('returns retryable failure on network exception', async () => {
      mcpService.executeTool.and.rejectWith(new Error('Connection refused'));

      const result = await service.cancelEquityOrder('123456789', 'order-456');

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
    });
  });

  describe('reconcileOrder', () => {
    it('returns found=true with state when order matches ref_id', async () => {
      mcpService.executeTool.and.resolveTo({
        success: true,
        parsed: {
          results: [
            { id: 'order-789', ref_id: 'ref-abc-123', state: 'filled', average_price: '150.25', filled_quantity: '10' },
            { id: 'order-999', ref_id: 'ref-other', state: 'cancelled' },
          ],
        },
        redacted: {},
        tool: 'get_equity_orders',
      });

      const result = await service.reconcileOrder('123456789', 'ref-abc-123');

      expect(result.found).toBe(true);
      expect(result.state).toBe('filled');
      expect(result.orderId).toBe('order-789');
      expect(result.fillPrice).toBe('150.25');
      expect(result.filledQuantity).toBe('10');
    });

    it('returns found=false when no order matches ref_id', async () => {
      mcpService.executeTool.and.resolveTo({
        success: true,
        parsed: {
          results: [
            { id: 'order-1', ref_id: 'ref-different', state: 'cancelled' },
          ],
        },
        redacted: {},
        tool: 'get_equity_orders',
      });

      const result = await service.reconcileOrder('123456789', 'ref-abc-123');

      expect(result.found).toBe(false);
      expect(result.state).toBeNull();
    });

    it('returns found=false when query fails', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Query failed',
        category: 'MCP',
      });

      const result = await service.reconcileOrder('123456789', 'ref-abc-123');

      expect(result.found).toBe(false);
      expect(result.state).toBeNull();
    });

    it('returns found=false on exception', async () => {
      mcpService.executeTool.and.rejectWith(new Error('Network error'));

      const result = await service.reconcileOrder('123456789', 'ref-abc-123');

      expect(result.found).toBe(false);
      expect(result.state).toBeNull();
    });

    it('returns found=false when results array is empty', async () => {
      mcpService.executeTool.and.resolveTo({
        success: true,
        parsed: { results: [] },
        redacted: {},
        tool: 'get_equity_orders',
      });

      const result = await service.reconcileOrder('123456789', 'ref-abc-123');

      expect(result.found).toBe(false);
    });
  });

  describe('error classification', () => {
    it('classifies PDT violation as non-retryable', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Pattern day trader rule violation',
        category: 'MCP',
      });

      const result = await service.submitEquityOrder(mockIntent());

      expect(result.error?.retryable).toBe(false);
    });

    it('classifies rate limit as retryable', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Rate limit exceeded',
        category: 'MCP',
      });

      const result = await service.submitEquityOrder(mockIntent());

      expect(result.error?.retryable).toBe(true);
    });

    it('classifies non-agentic account as non-retryable', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Account is not agentic_allowed',
        category: 'AUTH',
      });

      const result = await service.submitEquityOrder(mockIntent());

      expect(result.error?.retryable).toBe(false);
    });

    it('defaults unknown errors to retryable', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Some unknown error',
        category: 'UNKNOWN',
      });

      const result = await service.submitEquityOrder(mockIntent());

      expect(result.error?.retryable).toBe(true);
    });
  });
});
