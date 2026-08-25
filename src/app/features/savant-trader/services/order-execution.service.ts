/**
 * Savant Trader Order Execution Service
 *
 * Wraps RobinhoodMcpObservationService for equity order placement, cancellation,
 * and reconciliation. Does NOT handle user-facing confirmation dialogs — that is
 * the UI's responsibility. The review_equity_order preflight is a simulation, not
 * a confirmation gate.
 *
 * submitEquityOrder: review_equity_order (simulation preflight) → place_equity_order
 *   with ref_id idempotency. Classifies errors as retryable vs non-retryable.
 * cancelEquityOrder: calls cancel_equity_order.
 * reconcileOrder: queries get_equity_orders with ref_id to determine actual state
 *   of a stuck SUBMITTING intent.
 *
 * Ref: IMPL-savant-trader-order-placement-fe.md §5 (Order execution service)
 */
import { Injectable, inject } from '@angular/core';

import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';
import {
  EquityOrderIntent,
  OrderIntentError,
  OrderIntentResult,
} from './order-intent.types';

/** Result of a submit attempt. */
export interface ExecutionResult {
  success: boolean;
  result?: OrderIntentResult;
  error?: OrderIntentError;
}

/** Result of a reconciliation query. */
export interface ReconciliationResult {
  /** The actual state at the broker, or null if not found. */
  state: string | null;
  /** Whether the order was found at the broker. */
  found: boolean;
  /** Order ID if found. */
  orderId?: string;
  /** Fill details if filled. */
  fillPrice?: string;
  filledQuantity?: string;
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
  async submitEquityOrder(intent: EquityOrderIntent): Promise<ExecutionResult> {
    // Preflight: review_equity_order (simulation)
    try {
      const reviewResult = await this.mcpService.executeTool('review_equity_order', {
        args: this.buildReviewArgs(intent),
      });
      if (!reviewResult.success) {
        return {
          success: false,
          error: this.classifyError(reviewResult.error),
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
        args: this.buildPlaceArgs(intent),
      });
      if (!placeResult.success) {
        return {
          success: false,
          error: this.classifyError(placeResult.error),
        };
      }
      const parsed = placeResult.parsed as Record<string, unknown> | undefined;
      return {
        success: true,
        result: {
          orderId: parsed?.['id'] as string | undefined,
          state: parsed?.['state'] as string | undefined,
          fillPrice: parsed?.['average_price'] as string | undefined,
          filledQuantity: parsed?.['filled_quantity'] as string | undefined,
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

  /** Reconcile a stuck SUBMITTING intent by querying the broker for actual state. */
  async reconcileOrder(accountNumber: string, refId: string): Promise<ReconciliationResult> {
    try {
      const result = await this.mcpService.executeTool('get_equity_orders', {
        args: { account_number: accountNumber },
      });
      if (!result.success) {
        return { state: null, found: false };
      }
      const parsed = result.parsed as { results?: Array<Record<string, unknown>> } | undefined;
      const orders = parsed?.results ?? [];
      // Find the order matching our ref_id
      const match = orders.find((o) => o['ref_id'] === refId);
      if (!match) {
        return { state: null, found: false };
      }
      return {
        state: match['state'] as string | null,
        found: true,
        orderId: match['id'] as string | undefined,
        fillPrice: match['average_price'] as string | undefined,
        filledQuantity: match['filled_quantity'] as string | undefined,
      };
    } catch {
      return { state: null, found: false };
    }
  }

  /** Build the args for review_equity_order from an EquityOrderIntent. */
  private buildReviewArgs(intent: EquityOrderIntent): Record<string, unknown> {
    const args: Record<string, unknown> = {
      account_number: intent.accountNumber,
      symbol: intent.symbol,
      side: intent.side,
      type: intent.orderType,
    };
    if (intent.quantity) args['quantity'] = intent.quantity;
    if (intent.dollarAmount) args['dollar_amount'] = intent.dollarAmount;
    if (intent.limitPrice) args['limit_price'] = intent.limitPrice;
    if (intent.stopPrice) args['stop_price'] = intent.stopPrice;
    if (intent.timeInForce) args['time_in_force'] = intent.timeInForce;
    if (intent.marketHours) args['market_hours'] = intent.marketHours;
    if (intent.taxLots) args['tax_lots'] = intent.taxLots;
    return args;
  }

  /** Build the args for place_equity_order from an EquityOrderIntent. */
  private buildPlaceArgs(intent: EquityOrderIntent): Record<string, unknown> {
    const args = this.buildReviewArgs(intent);
    args['ref_id'] = intent.refId;
    return args;
  }

  /** Classify a ToolExecutionFailure error string as retryable or non-retryable. */
  private classifyError(error: string): OrderIntentError {
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
    // Callers (OrderStagingStore) MUST implement retry limits to prevent infinite loops.
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
