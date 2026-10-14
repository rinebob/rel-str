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
 * updateEquityStopOrder: cancel an existing protective stop → submit the replacement
 *   ticket with bounded retry. Reports which phase failed and whether the position
 *   was left unprotected (cancel succeeded but the replacement never landed).
 *
 * Ref: IMPL-savant-trader-order-placement-fe.md §5 (Order execution service)
 */
import { Injectable, inject } from '@angular/core';

import { RobinhoodMcpObservationService } from '../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
import { ScreenshotService } from '../../dev-screenshot/screenshot.service';
import { CaptureEvent, PositionType } from '@screenshot-capture/contracts';
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

/** Result of a stop-order update (cancel existing → place replacement). */
export interface UpdateStopResult extends ExecutionResult {
  /** Which phase failed — absent on success. */
  phase?: 'cancel' | 'place';
  /** True when the cancel succeeded but the replacement never landed — the position is unprotected. */
  unprotected?: boolean;
}

/**
 * RH enforces ref_id uniqueness with a 409 "Reference ID must be unique." —
 * captured live (mx-buy-lim-bid-409-refid). The message is also used by the
 * update loop to detect that an earlier attempt was registered broker-side.
 */
const REF_ID_CONFLICT_PATTERN = 'reference id must be unique';

/** Message for the PLACEMENT_UNCONFIRMED failure (see codes below). */
const PLACEMENT_UNCONFIRMED_MESSAGE = 'placement unconfirmed — no order id in response';

/**
 * `code` values on OrderTicketError for the "order may be registered" class —
 * keyed on code rather than message text so callers and the update loop can
 * branch without string-matching.
 * - PLACEMENT_UNCONFIRMED: success envelope with no order id (likely
 *   registered anyway), OR a registered order carrying an unrecognized/absent
 *   state — ambiguous either way; same-refId retry converges on the 409.
 * - PLACEMENT_DEAD: order registered (id known) but landed terminal — the
 *   refId is likely consumed; re-placement needs a FRESH ticket/refId.
 */
export const PLACEMENT_UNCONFIRMED_CODE = 'PLACEMENT_UNCONFIRMED';
export const PLACEMENT_DEAD_CODE = 'PLACEMENT_DEAD';

/**
 * Dead states that can carry fills — `cancelled` and
 * `partially_filled_rest_cancelled`. `rejected`/`failed`/`voided` never fill,
 * so an absent fill field there is unremarkable. Shared between
 * awaitCancelled's abort check, the place-loop dead split, and the store's
 * refId-mint decision.
 */
export const FILL_CAPABLE_DEAD_STATES = new Set(['cancelled', 'partially_filled_rest_cancelled']);

/** Known non-retryable error substrings from Robinhood — business rules that
 *  apply equally to tool-error text and thrown transport exceptions. */
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

/**
 * Terminal order-state / identity error substrings — applied to tool-error
 * text only (classifyError), never to thrown transport exceptions
 * (isRetryableException): 'not found' would otherwise misclassify a transient
 * "session not found" or HTTP 404 blip as terminal.
 */
const NON_RETRYABLE_ORDER_PATTERNS = [
  'not found',
  'already cancelled',
  'already canceled',
  'already filled',
  // Captured: "Order cannot be cancelled at this time." (403, mx-can-bid-403-filled)
  'cannot be cancelled',
  'cannot be canceled',
  // Captured: "Not enough shares to sell." (400) — retrying can't mint shares.
  'not enough shares',
  // Captured: "Some of your selected lots are no longer available." (400)
  'no longer available',
  // The ref_id is consumed — retrying the same ticket can never succeed.
  REF_ID_CONFLICT_PATTERN,
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

/**
 * Order states after a cancel request where the old order is definitively
 * gone and placing a replacement is safe. 'filled' is deliberately excluded —
 * the position state changed and the caller must refresh. Anything else
 * (live states, 'unknown', absent from the list) is unconfirmed.
 * 'partially_filled_rest_cancelled' is a cancelled-family terminal state RH
 * emits when a partially-filled order's remainder is cancelled (named in the
 * captured cancel guide) — the fill-adjacent check in awaitCancelled runs
 * first, so reaching this state with zero fills still proceeds.
 * Membership coincides with DEAD_ORDER_STATES today — they're semantically
 * distinct predicates (post-cancel confirmation vs place-response terminal),
 * so keep them separate if a sixth state arrives.
 */
const CANCELLED_STATES = new Set([
  'cancelled',
  'rejected',
  'failed',
  'voided',
  'partially_filled_rest_cancelled',
]);

/**
 * States where a placed order exists at the broker but is already dead —
 * a success response carrying one is not a live resting order. 'filled' is
 * deliberately absent: a market order can legitimately fill synchronously
 * (updateEquityStopOrder re-checks 'filled' separately as fill-adjacent).
 * Coincides with CANCELLED_STATES — see its note.
 */
const DEAD_ORDER_STATES = new Set([
  'rejected',
  'failed',
  'voided',
  'cancelled',
  'partially_filled_rest_cancelled',
]);

/**
 * States a place response can carry where the order is live/resting.
 * 'filled' is handled separately (legit synchronous market fill); any other
 * value — including novel RH states — is ambiguous rather than assumed live.
 * Coincides with LIVE_ORDER_STATES in portfolio-dashboard/order-states.util.ts
 * — kept local to avoid crossing the feature boundary for a place-response
 * predicate.
 */
const LIVE_PLACE_STATES = new Set([
  'new',
  'queued',
  'confirmed',
  'unconfirmed',
  'pending_cancelled',
  'partially_filled',
]);

@Injectable({ providedIn: 'root' })
export class OrderExecutionService {
  private readonly mcpService = inject(RobinhoodMcpObservationService);
  private readonly rhClient = inject(RobinhoodMcpClient);
  private readonly screenshots = inject(ScreenshotService);

  /** Total submit attempts for a replacement stop (initial + retries). */
  private static readonly MAX_PLACE_ATTEMPTS = 3;
  /** Backoff between replacement-submit attempts. */
  private static readonly RETRY_DELAY_MS = 500;
  /** Polls of get_equity_orders to confirm an accepted cancel landed. */
  private static readonly CANCEL_CONFIRM_ATTEMPTS = 3;
  /** Backoff between cancel-confirmation polls. */
  private static readonly CANCEL_CONFIRM_DELAY_MS = 500;

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
      const result: OrderTicketResult = brokerOrder
        ? {
            orderId: brokerOrder.id,
            state: brokerOrder.state,
            fillPrice: brokerOrder.price ?? undefined,
            filledQuantity: brokerOrder.cumulativeQuantity,
            brokerOrder,
          }
        : {
            orderId: direct?.['id'] as string | undefined,
            state: direct?.['state'] as string | undefined,
            fillPrice: direct?.['average_price'] as string | undefined,
            // cumulative_quantity is the verified RH fill field (order list
            // captures); filled_quantity is kept as a fallback only.
            filledQuantity: (direct?.['cumulative_quantity'] ?? direct?.['filled_quantity']) as string | undefined,
          };
      if (!result.orderId) {
        // A success envelope with no order id must not be reported as a placed
        // order — callers would persist an uncancellable phantom. Fail
        // retryable; a retry with the same refId converges on the 409.
        return {
          success: false,
          error: {
            message: PLACEMENT_UNCONFIRMED_MESSAGE,
            code: PLACEMENT_UNCONFIRMED_CODE,
            retryable: true,
          },
        };
      }
      // A place response that reports a terminal non-fill state means the
      // order exists but is already dead — not a live resting order.
      // 'filled' stays a success: a market order can fill synchronously.
      if (result.state && DEAD_ORDER_STATES.has(result.state)) {
        const fills = parseFloat(result.filledQuantity ?? '') || 0;
        return {
          success: false,
          result,
          error: {
            message: `order ${result.orderId} placed but already terminal (${result.state})${
              fills > 0 ? ` with ${fills} filled` : ''
            }`,
            code: PLACEMENT_DEAD_CODE,
            retryable: false,
          },
        };
      }
      // Anything that isn't a known-live state (or a synchronous 'filled')
      // is an unrecognized/absent state on a registered order — ambiguous,
      // not a phantom success. Classify as PLACEMENT_UNCONFIRMED so retries
      // converge on the refId 409 and callers reconcile rather than assume.
      if (result.state !== 'filled' && !(result.state && LIVE_PLACE_STATES.has(result.state))) {
        return {
          success: false,
          result,
          error: {
            message: result.state
              ? `order ${result.orderId} placed with unrecognized state '${result.state}'`
              : `order ${result.orderId} placed with no state in response`,
            code: PLACEMENT_UNCONFIRMED_CODE,
            retryable: true,
          },
        };
      }
      this.captureOrderSnapshot(ticket, result);
      return { success: true, result };
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
    return this.cancelOrder('cancel_equity_order', accountNumber, orderId);
  }

  /** Cancel an open option order by order_id. Caller should verify the order is not already in a terminal state. */
  async cancelOptionOrder(accountNumber: string, orderId: string): Promise<ExecutionResult> {
    return this.cancelOrder('cancel_option_order', accountNumber, orderId);
  }

  /**
   * Replace an existing protective stop: cancel it, then submit the replacement
   * ticket with bounded retry on retryable errors.
   *
   * Cancel failure → `{ phase: 'cancel', unprotected: false }` and place is never
   * attempted (placing on an uncertain cancel risks a duplicate stop). Place
   * failures retry up to MAX_PLACE_ATTEMPTS while retryable — the same ticket is
   * resubmitted so ref_id idempotency keeps a retry safe. Exhaustion or a
   * non-retryable error → `{ phase: 'place', unprotected: true }`: the old stop is
   * gone and the position has no protection until the caller re-places the ticket.
   *
   * Caller retry contract: `phase === 'cancel'` → the old order may still be
   * live — retry this whole method only while `error.retryable`; a non-retryable
   * cancel failure (order not found / cannot be cancelled / filled mid-cancel)
   * means position state changed, so refresh before acting. `phase === 'place'`
   * → call `submitEquityOrder` on the retained ticket (never re-cancel). When
   * `unprotected` is false on a place-phase failure, a ref_id conflict or an
   * unconfirmed placement ack means the replacement likely exists already —
   * reconcile open orders, do not re-place. One subtlety: a retryable
   * `phase: 'place'` failure that arrived *before any place attempt* means the
   * cancel was accepted but never confirmed cancelled — the old order is
   * almost certainly gone; reconcile its state, then re-place the ticket.
   *
   * Two edge returns worth knowing: an account-number mismatch fails before
   * any broker call with NO `phase` (no phase ran); and a place response whose
   * order landed dead (rejected/failed/voided/cancelled/rest-cancelled —
   * `error.code === 'PLACEMENT_DEAD'`) splits two ways: fills recorded or
   * fill state unknown → `{ phase: 'cancel', unprotected: false }` refresh-first
   * (the position may have shrunk); clean-dead → `{ phase: 'place',
   * unprotected: true }` where the refId is likely consumed — reconcile the
   * dead order (its id is forwarded on `result`) and re-place with a FRESH
   * ticket rather than assume the retained-ticket retry can succeed. A
   * synchronously-`filled` replacement is likewise fill-adjacent — position
   * exited — not a "protected" success.
   *
   * NOT reentrant: callers must serialize updates per order — two concurrent
   * calls on the same order can both confirm the cancel and then place two
   * different-refId replacements (two live stops → oversell on trigger).
   *
   * `unprotected` is a belief, not a guarantee: a place attempt can register
   * broker-side while its confirmation is lost to a timeout. When unsure,
   * reconcile open orders before assuming the position is exposed.
   *
   * Duration: nominal path is ~1-3s; worst case is bounded by the 90s MCP
   * tool timeout on each call (cancel + 3 confirm polls + 3 × review+place ≈
   * 15 min if every call wedges). Callers that time out mid-flight leave
   * genuinely ambiguous state — the cancel may be in-flight server-side.
   */
  async updateEquityStopOrder(
    accountNumber: string,
    orderId: string,
    ticket: EquityOrderTicket,
  ): Promise<UpdateStopResult> {
    return this.replaceEquityOrder(accountNumber, orderId, ticket, 'stop');
  }

  /**
   * Generalized cancel-and-replace for an equity order: cancel `orderId`,
   * confirm the cancel landed (`awaitCancelled` — RH cancel is async, an
   * accepted cancel can still fill), then submit `ticket` with bounded
   * retry on retryable errors. Same phase/unprotected contract as
   * `updateEquityStopOrder` (see its doc) — `noun` only labels the
   * replacement in error messages ('stop' vs 'order').
   *
   * NOT reentrant: serialize per order — two concurrent replaces can both
   * confirm the cancel and place two different-refId replacements.
   */
  async replaceEquityOrder(
    accountNumber: string,
    orderId: string,
    ticket: EquityOrderTicket,
    noun: 'stop' | 'order' = 'stop',
  ): Promise<UpdateStopResult> {
    if (accountNumber !== ticket.accountNumber) {
      return {
        success: false,
        unprotected: false,
        error: {
          message: `accountNumber '${accountNumber}' does not match ticket.accountNumber '${ticket.accountNumber}'`,
          retryable: false,
        },
      };
    }
    const cancel = await this.cancelEquityOrder(accountNumber, orderId);
    if (!cancel.success) {
      return { success: false, phase: 'cancel', unprotected: false, error: cancel.error };
    }

    // RH cancel is asynchronous — `accepted: true` means the request was
    // accepted, not that the order is terminal (guide note in the mx-can-bid
    // captures). The old stop can still fill in the race; placing before the
    // cancel lands risks overselling a position that already exited.
    const confirm = await this.awaitCancelled(accountNumber, orderId);
    if (!confirm.success) {
      if (confirm.error?.retryable === false) {
        // Fill-adjacent abort — the position exited or shrank under us.
        // phase 'cancel' + unprotected:false: refresh, do not re-place.
        return { success: false, phase: 'cancel', unprotected: false, error: confirm.error };
      }
      // Accepted-but-unconfirmed: the cancel WAS accepted — the old order is
      // past the point of return even if we couldn't observe it land. This is
      // NOT a cancel-phase failure: re-cancelling would hit a terminal
      // rejection on an already-cancelled order. Report it as a place-phase
      // failure so the caller contract (re-place the retained ticket, never
      // re-cancel) applies — with unprotected:true because the position is
      // likely bare. The message directs the caller to reconcile first.
      return { success: false, phase: 'place', unprotected: true, error: confirm.error };
    }

    let lastError: OrderTicketError | undefined;
    let lastResult: OrderTicketResult | undefined;
    // True when a place call registered the order but we can't confirm it as
    // live — no order id, or an unrecognized/absent state. Either way the
    // order may exist broker-side; do not report unprotected.
    let placementUnconfirmed = false;
    for (let attempt = 1; attempt <= OrderExecutionService.MAX_PLACE_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await this.delay(OrderExecutionService.RETRY_DELAY_MS);
      }
      const result = await this.submitEquityOrder(ticket);
      if (result.success) {
        // A synchronously-filled replacement means the position exited — the
        // stop triggered immediately or the position was gone. This is the
        // same class as a fill-during-cancel: refresh, do not re-place.
        if (result.result?.state === 'filled') {
          return {
            success: false,
            phase: 'cancel',
            unprotected: false,
            result: result.result,
            error: {
              message: `replacement ${noun} ${result.result.orderId} filled immediately — position exited; refresh before updating`,
              retryable: false,
            },
          };
        }
        return { success: true, result: result.result };
      }
      lastError = result.error;
      lastResult = result.result ?? lastResult;
      if (result.error?.code === PLACEMENT_UNCONFIRMED_CODE) {
        // Success envelope with no parseable order — likely registered anyway.
        // Resubmitting the same refId converges on a 409 conflict below.
        placementUnconfirmed = true;
      }
      if (result.error?.code === PLACEMENT_DEAD_CODE) {
        // The replacement registered but landed dead. If it carried fills —
        // or is a fill-capable dead state (cancelled/rest-cancelled) with the
        // fill field absent, same ambiguity rule as awaitCancelled — the
        // position shrank and the retained ticket's original quantity would
        // oversell: refresh first.
        const filledRaw = result.result?.filledQuantity;
        const fills = parseFloat(filledRaw ?? '') || 0;
        // Absent OR unparseable fill field on a fill-capable dead state is
        // ambiguous — do not assume zero fills over a shrunken position.
        const fillAmbiguous =
          FILL_CAPABLE_DEAD_STATES.has(result.result?.state ?? '') &&
          !Number.isFinite(parseFloat(filledRaw ?? ''));
        if (fills > 0 || fillAmbiguous) {
          return {
            success: false,
            phase: 'cancel',
            unprotected: false,
            result: result.result,
            error: {
              message: `replacement ${noun} ${result.result!.orderId} ${fills > 0 ? 'partially filled then died' : 'died with fill state unknown'} — position may have shrunk; refresh before updating`,
              retryable: false,
            },
          };
        }
        // Dead with zero fills — refId is likely consumed; a retained-ticket
        // retry 409s harmlessly. Report unprotected and let the caller mint a
        // fresh ticket.
        return {
          success: false,
          phase: 'place',
          unprotected: true,
          result: result.result,
          error: {
            ...result.error!,
            message: `${result.error!.message} — refId may be consumed; reconcile the dead order and re-place with a fresh ticket`,
          },
        };
      }
      if (!result.error?.retryable) break;
    }
    // A ref_id conflict (RH 409 "Reference ID must be unique") can only occur
    // when an earlier attempt with this refId was registered broker-side — the
    // replacement stop exists even though we never saw its confirmation. Do not
    // report the position as unprotected; the caller must reconcile orders
    // rather than place a duplicate.
    const refIdConflict = lastError?.message.toLowerCase().includes(REF_ID_CONFLICT_PATTERN);
    return {
      success: false,
      phase: 'place',
      unprotected: !(refIdConflict || placementUnconfirmed),
      // Forward the last seen order result (e.g. an unrecognized-state order's
      // id) so the caller can reconcile by id.
      ...(lastResult ? { result: lastResult } : {}),
      error: lastError,
    };
  }

  /**
   * Confirm an accepted cancel actually landed: poll `get_equity_orders` in
   * single-order mode (`order_id` — the list endpoint is paginated, and GTC
   * stops are exactly the orders that sit deep in history) until the order
   * reaches a cancelled-family state.
   *
   * A fill-adjacent outcome — `filled`, `partially_filled`, any
   * `cumulativeQuantity > 0`, any recorded `executions`, or a fill-capable
   * dead state (`cancelled`, `partially_filled_rest_cancelled`) with an
   * absent `cumulative_quantity` (cancelled-with-fills is real; a missing
   * field is ambiguous) — aborts non-retryably: the position exited or shrank
   * under us, and the replacement ticket carries the original quantity.
   * Live/absent/unknown states retry within a small budget.
   * Still-unconfirmed after the budget is a retryable failure — but the
   * cancel WAS accepted, so the caller must treat this as needing
   * reconciliation + re-place (phase 'place'), never a re-cancel.
   */
  private async awaitCancelled(accountNumber: string, orderId: string): Promise<ExecutionResult> {
    let lastFetchError: unknown;
    for (let poll = 1; poll <= OrderExecutionService.CANCEL_CONFIRM_ATTEMPTS; poll++) {
      try {
        const orders = await this.rhClient.getEquityOrders(accountNumber, { orderId });
        const order = orders.find((o) => o.orderId === orderId);
        const filledQty = order?.cumulativeQuantity ?? 0;
        const executions = order?.executions?.length ?? 0;
        // Fill-adjacent: 'filled'/'partially_filled' by name, any recorded
        // fills, or a fill-capable cancelled state with an absent
        // cumulative_quantity (ambiguous — cancelled-with-fills is real; do
        // not assume zero). rejected/failed/voided never fill, so a missing
        // field there is unremarkable.
        const fillAdjacent =
          order &&
          (order.state === 'filled' ||
            order.state === 'partially_filled' ||
            filledQty > 0 ||
            executions > 0 ||
            (FILL_CAPABLE_DEAD_STATES.has(order.state) && order.cumulativeQuantity === null));
        if (fillAdjacent) {
          return {
            success: false,
            error: {
              message: `order ${orderId} ${order.state === 'filled' || filledQty > 0 || order.state === 'partially_filled' ? 'filled or partially filled' : 'may have partially filled'} before the cancel completed — position state changed; refresh before updating`,
              retryable: false,
            },
          };
        }
        if (order && CANCELLED_STATES.has(order.state)) {
          return { success: true };
        }
      } catch (err) {
        // Confirmation fetch failed — the cancel itself was accepted, so keep
        // polling within the budget rather than declaring defeat.
        lastFetchError = err;
      }
      if (poll < OrderExecutionService.CANCEL_CONFIRM_ATTEMPTS) {
        await this.delay(OrderExecutionService.CANCEL_CONFIRM_DELAY_MS);
      }
    }
    return {
      success: false,
      error: {
        message: `cancel accepted but order ${orderId} not confirmed cancelled${
          lastFetchError ? ` (state fetch failed: ${lastFetchError instanceof Error ? lastFetchError.message : String(lastFetchError)})` : ''
        } — reconcile order state; if it shows cancelled, re-place the retained ticket via submitEquityOrder (never re-cancel)`,
        retryable: true,
      },
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Lifecycle documentation (Topic #746): fire-and-forget chart capture on a
   *  confirmed-live or synchronously-filled order. Callers detect and pass
   *  the event; this side only produces the screenshot. Failures log and are
   *  swallowed — a capture outage must never affect the order path. */
  private captureOrderSnapshot(ticket: EquityOrderTicket, result: OrderTicketResult): void {
    try {
      const event = result.state === 'filled' ? CaptureEvent.ORDER_FILLED : CaptureEvent.ORDER_PLACED;
      this.screenshots.captureChartSnapshot$({
        symbol: ticket.symbol,
        event,
        positionType: PositionType.STOCK,
        refId: ticket.refId,
        groupId: ticket.refId,
        renderOnly: false,
      }).subscribe({
        error: (err: unknown) => {
          console.warn(`[OrderExecution] screenshot capture failed for ${ticket.symbol} (${event}):`, err);
        },
      });
    } catch (err) {
      console.warn(`[OrderExecution] screenshot capture threw for ${ticket.symbol}:`, err);
    }
  }

  private async cancelOrder(
    tool: 'cancel_equity_order' | 'cancel_option_order',
    accountNumber: string,
    orderId: string,
  ): Promise<ExecutionResult> {
    try {
      const result = await this.mcpService.executeTool(tool, {
        args: { account_number: accountNumber, order_id: orderId },
      });
      const error = this.extractToolError(result);
      if (error) {
        return {
          success: false,
          error: this.classifyError(error),
        };
      }
      // Explicit non-acceptance is a rejected cancel — fail at the cancel
      // phase. An ABSENT field still proceeds: only `accepted:true` is proven
      // by captures, and the confirmation poll is the real truth source.
      // (parsed/redacted exist only on ToolExecutionSuccess — the extractToolError
      // null return doesn't narrow the union for the compiler.)
      if (result.success) {
        const accepted =
          (result.parsed as { data?: { accepted?: unknown } } | undefined)?.data?.accepted ??
          (result.redacted as { data?: { accepted?: unknown } } | undefined)?.data?.accepted;
        if (accepted === false) {
          return {
            success: false,
            error: { message: 'cancel request was not accepted by the broker', retryable: false },
          };
        }
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

  /**
   * Extract MCP tool errors from a transport response. Three channels can carry
   * a tool-level rejection on an otherwise successful call — the executor's
   * `toolError` field (the only carrier when the error text parses as JSON, per
   * the wire contract), then `isError` envelopes in `parsed` and `redacted`.
   */
  private extractToolError(result: {
    success: boolean;
    error?: string;
    toolError?: string;
    parsed?: unknown;
    redacted?: unknown;
  }): string | null {
    if (!result.success) return result.error ?? 'Robinhood tool execution failed';
    // Guard on truthiness, not type — an empty-string toolError must not mask
    // an isError envelope under parsed/redacted.
    if (result.toolError) return result.toolError;
    return this.envelopeToolError(result.parsed) ?? this.envelopeToolError(result.redacted);
  }

  /** Extract the error text from an `isError` tool envelope (top-level or under `data`). */
  private envelopeToolError(carrier: unknown): string | null {
    if (!carrier || typeof carrier !== 'object') return null;
    const envelope = carrier as Record<string, unknown>;
    const data = envelope['data'];
    const inner = data && typeof data === 'object' ? data as Record<string, unknown> : undefined;
    if (envelope['isError'] !== true && inner?.['isError'] !== true) return null;
    // The flag and the message can live at different levels — check both.
    return (
      this.envelopeMessage(envelope) ??
      (inner ? this.envelopeMessage(inner) : null) ??
      'Robinhood rejected the order request'
    );
  }

  private envelopeMessage(target: Record<string, unknown>): string | null {
    if (typeof target['error'] === 'string') return target['error'];
    const content = target['content'];
    if (Array.isArray(content)) {
      const text = content.find((item) =>
        item && typeof item === 'object' && typeof (item as Record<string, unknown>)['text'] === 'string',
      ) as Record<string, unknown> | undefined;
      if (typeof text?.['text'] === 'string') return text['text'];
    }
    return null;
  }

  /** Classify a tool-error string as retryable or non-retryable. */
  private classifyError(error: string): OrderTicketError {
    const lower = error.toLowerCase();
    for (const pattern of [...NON_RETRYABLE_PATTERNS, ...NON_RETRYABLE_ORDER_PATTERNS]) {
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
    // Callers must bound retries — updateEquityStopOrder caps at 3 attempts.
    return { message: error, retryable: true };
  }

  /** Classify a thrown exception as retryable. */
  private isRetryableException(err: unknown): boolean {
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    // The ref-id pattern is an identity error — safe on the throw path too
    // (unlike 'not found', it can't match transient transport noise).
    if (message.includes(REF_ID_CONFLICT_PATTERN)) return false;
    for (const pattern of NON_RETRYABLE_PATTERNS) {
      if (message.includes(pattern)) return false;
    }
    return true;
  }
}
