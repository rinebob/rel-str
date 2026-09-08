/**
 * Savant Trader Order Execution Service
 *
 * Wraps RobinhoodMcpObservationService for equity order placement and cancellation.
 * Does NOT handle user-facing confirmation dialogs — that is the UI's responsibility.
 * The review_equity_order preflight is a simulation, not a confirmation gate.
 *
 * submitEquityOrder: review_equity_order (simulation preflight) → place_equity_order
 *   with ref_id idempotency. Classifies errors as retryable vs non-retryable.
 * cancelEquityOrder: calls cancel_equity_order.
 *
 * Ref: IMPL-savant-trader-order-placement-fe.md §5 (Order execution service)
 */
import { Injectable, inject } from '@angular/core';

import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';
import {
  BrokerOrderSnapshot,
  EquityOrderTicket,
  OrderTicketError,
  OrderTicketResult,
} from './order-ticket.types';

/** Result of a submit attempt. */
export interface ExecutionResult {
  success: boolean;
  result?: OrderTicketResult;
  error?: OrderTicketError;
}

/** Known non-retryable error substrings from Robinhood. */
const NON_RETRYABLE_PATTERNS = [
  'insufficient buying power',
  'insufficient funds',
  'invalid symbol',
  'not tradable',
  'not agentic',
  'agentic_allowed',
  'pattern day trader',
  'pdt',
  'fractional disabled',
  'fractional not allowed',
];

/** Known retryable error substrings. */
const RETRYABLE_PATTERNS = [
  'timeout',
  'timed out',
  'network',
  'connection',
  'temporarily unavailable',
  'rate limit',
  'too many requests',
  '5xx',
  '503',
  '502',
  '500',
];

@Injectable({ providedIn: 'root' })
export class OrderExecutionService {
  private readonly mcpService = inject(RobinhoodMcpObservationService);

  /** Submit an equity order: preflight review, then place with ref_id idempotency. */
  async submitEquityOrder(ticket: EquityOrderTicket): Promise<ExecutionResult> {
    // Preflight: review_equity_order (simulation)
    try {
      const reviewResult = await this.mcpService.executeTool('review_equity_order', {
        args: this.buildReviewArgs(ticket),
      });
      const reviewError = this.extractToolError(reviewResult);
      if (reviewError) {
        return {
          success: false,
          error: this.classifyError(reviewError),
        };
      }
    } catch (err) {
      // Preflight exception — classify using the same patterns as real errors
      return {
        success: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          retryable: this.isRetryableException(err),
        },
      };
    }

    // Place the real order with ref_id idempotency
    try {
      const placeResult = await this.mcpService.executeTool('place_equity_order', {
        args: this.buildPlaceArgs(ticket),
      });
      const placeError = this.extractToolError(placeResult);
      if (placeError) {
        return {
          success: false,
          error: this.classifyError(placeError),
        };
      }
      const parsed = (placeResult as { parsed?: unknown }).parsed;
      const brokerOrder = this.parseBrokerOrder(parsed);
      const direct = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
      return {
        success: true,
        result: brokerOrder
          ? {
              orderId: brokerOrder.id,
              state: brokerOrder.state,
              fillPrice: brokerOrder.price ?? undefined,
              filledQuantity: brokerOrder.cumulativeQuantity ?? brokerOrder.quantity,
              brokerOrder,
            }
          : {
              orderId: direct?.['id'] as string | undefined,
              state: direct?.['state'] as string | undefined,
              fillPrice: direct?.['average_price'] as string | undefined,
              filledQuantity: direct?.['filled_quantity'] as string | undefined,
            },
      };
    } catch (err) {
      return {
        success: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          retryable: this.isRetryableException(err),
        },
      };
    }
  }

  /** Cancel an open equity order by order_id. Caller should verify the order is not already in a terminal state. */
  async cancelEquityOrder(accountNumber: string, orderId: string): Promise<ExecutionResult> {
    try {
      const result = await this.mcpService.executeTool('cancel_equity_order', {
        args: { account_number: accountNumber, order_id: orderId },
      });
      if (!result.success) {
        return {
          success: false,
          error: this.classifyError(result.error),
        };
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          retryable: this.isRetryableException(err),
        },
      };
    }
  }

  /** Build the args for review_equity_order from an EquityOrderTicket. */
  private buildReviewArgs(ticket: EquityOrderTicket): Record<string, unknown> {
    const args: Record<string, unknown> = {
      account_number: ticket.accountNumber,
      symbol: ticket.symbol,
      side: ticket.side,
      type: ticket.orderType === 'stop_loss' ? 'stop_market' : ticket.orderType,
    };
    // Always send whole-share quantity — never dollar_amount (causes fractional shares,
    // which can't have stop loss orders). The ticket component computes quantity from
    // dollarAmount × price before submission.
    if (ticket.quantity) {
      args['quantity'] = ticket.quantity;
    }
    if (ticket.limitPrice) args['limit_price'] = ticket.limitPrice;
    if (ticket.stopPrice) args['stop_price'] = ticket.stopPrice;
    if (ticket.timeInForce) args['time_in_force'] = ticket.timeInForce;
    if (ticket.marketHours) args['market_hours'] = ticket.marketHours;
    if (ticket.taxLots) args['tax_lots'] = ticket.taxLots;
    return args;
  }

  /** Build the args for place_equity_order from an EquityOrderTicket. */
  private buildPlaceArgs(ticket: EquityOrderTicket): Record<string, unknown> {
    const args = this.buildReviewArgs(ticket);
    args['ref_id'] = ticket.refId;
    return args;
  }

  /** Normalize the nested or direct broker order response into the persisted shape. */
  private parseBrokerOrder(parsed: unknown): BrokerOrderSnapshot | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const root = parsed as Record<string, unknown>;
    const data = root['data'];
    const dataRecord = data && typeof data === 'object' ? data as Record<string, unknown> : undefined;
    const order = dataRecord?.['order'] ?? root['order'] ?? parsed;
    if (!order || typeof order !== 'object') return null;
    const value = order as Record<string, unknown>;
    if (typeof value['id'] !== 'string' || typeof value['symbol'] !== 'string' || typeof value['state'] !== 'string') return null;
    return {
      id: value['id'],
      instrumentId: value['instrument_id'] as string | undefined,
      symbol: value['symbol'],
      side: String(value['side'] ?? ''),
      type: String(value['type'] ?? ''),
      state: value['state'],
      quantity: value['quantity'] as string | undefined,
      cumulativeQuantity: value['cumulative_quantity'] as string | undefined,
      price: value['price'] as string | null | undefined,
      stopPrice: value['stop_price'] as string | null | undefined,
      fees: value['fees'] as string | undefined,
      dollarBasedAmount: value['dollar_based_amount'] as string | null | undefined,
      timeInForce: value['time_in_force'] as string | undefined,
      marketHours: value['market_hours'] as string | undefined,
      trigger: value['trigger'] as string | undefined,
      placedAgent: value['placed_agent'] as string | undefined,
      createdAt: value['created_at'] as string | undefined,
      lastTransactionAt: value['last_transaction_at'] as string | undefined,
      executions: Array.isArray(value['executions']) ? value['executions'] : undefined,
    };
  }

  /** Extract MCP tool errors embedded in an otherwise successful transport response. */
  private extractToolError(result: {
    success: boolean;
    error?: string;
    redacted?: unknown;
  }): string | null {
    if (!result.success) return result.error ?? 'Robinhood tool execution failed';
    if (!result.redacted || typeof result.redacted !== 'object') return null;
    const redacted = result.redacted as Record<string, unknown>;
    if (redacted['isError'] !== true) return null;
    const content = redacted['content'];
    if (Array.isArray(content)) {
      const text = content.find((item) =>
        item && typeof item === 'object' && typeof (item as Record<string, unknown>)['text'] === 'string',
      ) as Record<string, unknown> | undefined;
      if (typeof text?.['text'] === 'string') return text['text'];
    }
    return 'Robinhood rejected the order request';
  }

  /** Classify a ToolExecutionFailure error string as retryable or non-retryable. */
  private classifyError(error: string): OrderTicketError {
    const lower = error.toLowerCase();
    for (const pattern of NON_RETRYABLE_PATTERNS) {
      if (lower.includes(pattern)) {
        return { message: error, retryable: false };
      }
    }
    for (const pattern of RETRYABLE_PATTERNS) {
      if (lower.includes(pattern)) {
        return { message: error, retryable: true };
      }
    }
    // Default: unknown errors are retryable (safer — user can decide).
    // Callers (OrderTicketStore) MUST implement retry limits to prevent infinite loops.
    return { message: error, retryable: true };
  }

  /** Classify a thrown exception as retryable. */
  private isRetryableException(err: unknown): boolean {
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    for (const pattern of NON_RETRYABLE_PATTERNS) {
      if (message.includes(pattern)) return false;
    }
    return true;
  }
}
