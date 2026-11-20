/**
 * UpdateAllStopsService — the sequential batch-ratchet orchestrator (#890).
 * OrderExecutionService is mocked: the seam is the service's public
 * signals (status/results/currentIndex), its call sequence, and the
 * phase-contract retry paths (cancel→whole primitive, place→re-place
 * the retained ticket, PLACEMENT_DEAD→fresh refId, !unprotected→no retry).
 */
import { TestBed } from '@angular/core/testing';

import { UpdateAllStopsService } from './update-all-stops.service';
import { OrderExecutionService } from '../../savant-trader/services/order-execution.service';
import type { StopUpdateCandidate } from '../utils/portfolio-pnl.util';
import type { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import type {
  ExecutionResult,
  UpdateStopResult,
} from '../../savant-trader/services/order-execution.service';

function makeOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'order-1',
    accountNumber: '123456789',
    instrumentType: 'equity',
    symbol: 'AAPL',
    side: 'sell',
    type: 'stop_market',
    state: 'confirmed',
    quantity: 100,
    cumulativeQuantity: 0,
    price: null,
    stopPrice: 145,
    averageFillPrice: null,
    createdAt: '2026-01-15T10:00:00Z',
    marketHours: 'regular_hours',
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<StopUpdateCandidate> = {}): StopUpdateCandidate {
  return {
    order: makeOrder(),
    symbol: 'AAPL',
    currentStopPrice: 145,
    peakPrice: 200,
    exposurePct: 27.5,
    computedStopPrice: 180,
    disposition: 'update',
    ...overrides,
  };
}

const OK: UpdateStopResult = { success: true };
const PLACE_OK: ExecutionResult = { success: true };
const FAIL_CANCEL_RETRYABLE: UpdateStopResult = {
  success: false,
  phase: 'cancel',
  unprotected: false,
  error: { message: 'cancel rejected', retryable: true },
};
const FAIL_CANCEL_DEAD: UpdateStopResult = {
  success: false,
  phase: 'cancel',
  unprotected: false,
  error: { message: 'order already terminal', retryable: false },
};
const FAIL_PLACE_UNPROTECTED: UpdateStopResult = {
  success: false,
  phase: 'place',
  unprotected: true,
  error: { message: 'placement failed', retryable: false },
};
const FAIL_PLACE_DEAD: UpdateStopResult = {
  success: false,
  phase: 'place',
  unprotected: true,
  error: { message: 'placement dead', retryable: false, code: 'PLACEMENT_DEAD' },
};
const FAIL_PLACE_REGISTERED: UpdateStopResult = {
  success: false,
  phase: 'place',
  unprotected: false,
  error: { message: 'ref id conflict', retryable: true },
};

const CTX = { accountNumber: '123456789' };

describe('UpdateAllStopsService', () => {
  let service: UpdateAllStopsService;
  let update: jest.Mock<Promise<UpdateStopResult>>;
  let submit: jest.Mock<Promise<ExecutionResult>>;

  beforeEach(() => {
    update = jest.fn<Promise<UpdateStopResult>, [string, string, unknown]>().mockResolvedValue(OK);
    submit = jest.fn<Promise<ExecutionResult>, [unknown]>().mockResolvedValue(PLACE_OK);
    TestBed.configureTestingModule({
      providers: [
        UpdateAllStopsService,
        {
          provide: OrderExecutionService,
          useValue: {
            updateEquityStopOrder: update,
            submitEquityOrder: submit,
          },
        },
      ],
    });
    service = TestBed.inject(UpdateAllStopsService);
  });

  // ── run sequencing + dispositions ────────────────────────────────

  it('runs update candidates sequentially — call N+1 starts only after N resolves', async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    update.mockImplementation(async (_a: string, orderId: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(orderId);
      // Yield so a parallel implementation would overlap observably.
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
      return OK;
    });

    await service.run([makeCandidate(), makeCandidate({ order: makeOrder({ orderId: 'o2' }) })], CTX);

    expect(order).toEqual(['order-1', 'o2']);
    expect(maxInFlight).toBe(1);
    expect(service.status()).toBe('done');
    expect(service.results().map((r) => r.status)).toEqual(['updated', 'updated']);
  });

  it('records non-update dispositions as skipped without touching the broker', async () => {
    await service.run(
      [
        makeCandidate({ disposition: 'within-policy' }),
        makeCandidate({ disposition: 'skip-no-price', computedStopPrice: null }),
      ],
      CTX,
    );

    expect(update).not.toHaveBeenCalled();
    expect(service.results().map((r) => r.status)).toEqual(['skipped', 'skipped']);
    expect(service.status()).toBe('done');
  });

  it('marks a fractional-quantity candidate skipped — a pre-flight miss, never a broker call or abort', async () => {
    const frac = makeCandidate({ order: makeOrder({ quantity: 0.5 }) });
    const healthy = makeCandidate({ order: makeOrder({ orderId: 'o2' }) });

    await service.run([frac, healthy], CTX);

    expect(service.results()[0].status).toBe('skipped');
    expect(service.results()[0].error).toContain('whole shares');
    // The rest of the run still executes — a data precondition is not
    // broker ambiguity.
    expect(service.results()[1].status).toBe('updated');
    expect(update).toHaveBeenCalledTimes(1);
    expect(service.status()).toBe('done');
  });

  it('builds the replacement ticket GTC + regular_hours (stops cannot trade extended) with stop_loss_update provenance', async () => {
    const candidate = makeCandidate({ order: makeOrder({ marketHours: 'extended_hours' }) });

    await service.run([candidate], CTX);

    const [acct, orderId, ticket] = update.mock.calls[0] as [string, string, any];
    expect(acct).toBe('123456789');
    expect(orderId).toBe('order-1');
    expect(ticket.timeInForce).toBe('gtc');
    expect(ticket.marketHours).toBe('regular_hours');
    expect(ticket.sourceRef).toEqual({ type: 'stop_loss_update', id: 'order-1' });
    expect(ticket.quantity).toBe('100'); // order's own whole-share quantity
    expect(ticket.stopPrice).toBe('180.00');
  });

  it('a same-symbol ladder tickets each order with its OWN quantity — never the full position', async () => {
    const s1 = makeCandidate({ order: makeOrder({ orderId: 's1', quantity: 40 }) });
    const s2 = makeCandidate({ order: makeOrder({ orderId: 's2', quantity: 60 }) });

    await service.run([s1, s2], CTX);

    const q = (i: number) => (update.mock.calls[i] as unknown[])[2] as { quantity: string };
    expect(q(0).quantity).toBe('40');
    expect(q(1).quantity).toBe('60');
  });

  it('marks the failed row and leaves the rest not-run on a failure', async () => {
    update.mockResolvedValue(FAIL_PLACE_UNPROTECTED);

    await service.run(
      [
        makeCandidate(),
        makeCandidate({ order: makeOrder({ orderId: 'o2' }) }),
        makeCandidate({ order: makeOrder({ orderId: 'o3' }) }),
      ],
      CTX,
    );

    const statuses = service.results().map((r) => r.status);
    expect(statuses).toEqual(['failed', 'not-run', 'not-run']);
    expect(service.status()).toBe('aborted');
    expect(service.results()[0].unprotected).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('a second run resets prior results and status', async () => {
    await service.run([makeCandidate()], CTX);
    await service.run([makeCandidate({ order: makeOrder({ orderId: 'o9' }) })], CTX);

    expect(service.results().map((r) => r.candidate.order.orderId)).toEqual(['o9']);
    expect(service.status()).toBe('done');
  });

  // ── canRetry — the contract matrix the summary renders ───────────

  it('canRetry: cancel-phase retryable → true; cancel-phase dead → false', async () => {
    update.mockResolvedValueOnce(FAIL_CANCEL_RETRYABLE);
    await service.run([makeCandidate()], CTX);
    expect(service.canRetry(service.results()[0])).toBe(true);

    update.mockResolvedValueOnce(FAIL_CANCEL_DEAD);
    await service.run([makeCandidate()], CTX);
    expect(service.canRetry(service.results()[0])).toBe(false);
  });

  it('canRetry: place-phase unprotected → true; place-phase likely-registered → false; not-run → true', async () => {
    update.mockResolvedValueOnce(FAIL_PLACE_UNPROTECTED);
    await service.run([makeCandidate()], CTX);
    expect(service.canRetry(service.results()[0])).toBe(true);

    update.mockResolvedValueOnce(FAIL_PLACE_REGISTERED);
    await service.run([makeCandidate()], CTX);
    expect(service.canRetry(service.results()[0])).toBe(false);

    update.mockResolvedValueOnce(FAIL_PLACE_UNPROTECTED);
    await service.run([makeCandidate(), makeCandidate({ order: makeOrder({ orderId: 'o2' }) })], CTX);
    expect(service.canRetry(service.results()[1])).toBe(true); // not-run
  });

  // ── retryOne — the phase contract ────────────────────────────────

  it('cancel-phase retry re-runs the whole primitive on the retained ticket (same refId)', async () => {
    update.mockResolvedValueOnce(FAIL_CANCEL_RETRYABLE);
    await service.run([makeCandidate()], CTX);
    const firstRef = (update.mock.calls[0] as unknown[])[2] as { refId: string };

    update.mockResolvedValueOnce(OK);
    await service.retryOne(service.results()[0]);

    expect(update).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
    expect((update.mock.calls[1] as unknown[])[2]).toEqual(firstRef);
    expect(service.results()[0].status).toBe('updated');
    expect(service.status()).toBe('done');
  });

  it('place-phase + unprotected retry re-places via submitEquityOrder — never re-cancels', async () => {
    update.mockResolvedValueOnce(FAIL_PLACE_UNPROTECTED);
    await service.run([makeCandidate()], CTX);
    const placedRef = (update.mock.calls[0] as unknown[])[2] as { refId: string };

    submit.mockResolvedValueOnce(PLACE_OK);
    await service.retryOne(service.results()[0]);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1); // NO re-cancel
    const ticket = submit.mock.calls[0][0] as { refId: string };
    expect(ticket.refId).toBe(placedRef.refId); // same retained ticket
    expect(service.results()[0].status).toBe('updated');
    expect(service.status()).toBe('done');
  });

  it('PLACEMENT_DEAD retry mints a fresh refId — the burned one dedups onto the dead order', async () => {
    update.mockResolvedValueOnce(FAIL_PLACE_DEAD);
    await service.run([makeCandidate()], CTX);
    const burnedRef = (update.mock.calls[0] as unknown[])[2] as { refId: string };

    submit.mockResolvedValueOnce(PLACE_OK);
    await service.retryOne(service.results()[0]);

    const ticket = submit.mock.calls[0][0] as { refId: string; sourceRef: unknown };
    expect(ticket.refId).not.toBe(burnedRef.refId);
    expect(ticket.sourceRef).toEqual({ type: 'stop_loss_update', id: 'order-1' });
  });

  it('place-phase + !unprotected retry is refused — the replacement likely registered; re-placing would duplicate', async () => {
    update.mockResolvedValueOnce(FAIL_PLACE_REGISTERED);
    await service.run([makeCandidate()], CTX);

    await service.retryOne(service.results()[0]);

    expect(submit).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(service.results()[0].status).toBe('failed');
  });

  it('not-run retry runs the full primitive — the order was never touched', async () => {
    update.mockResolvedValueOnce(FAIL_PLACE_UNPROTECTED);
    await service.run([makeCandidate(), makeCandidate({ order: makeOrder({ orderId: 'o2' }) })], CTX);
    expect(service.results()[1].status).toBe('not-run');

    update.mockResolvedValueOnce(OK);
    await service.retryOne(service.results()[1]);

    expect(update).toHaveBeenCalledTimes(2);
    expect(service.results()[1].status).toBe('updated');
  });

  it('a stale outcome snapshot cannot retry — the live row is re-located, and a stale patch no-ops', async () => {
    await service.run([makeCandidate()], CTX);
    const stale = service.results()[0];
    await service.run([makeCandidate({ order: makeOrder({ orderId: 'o9' }) })], CTX);

    await service.retryOne(stale); // from run 1 — no live row matches

    expect(update).toHaveBeenCalledTimes(2); // only the two runs' calls
    expect(submit).not.toHaveBeenCalled();
  });

  it('retryOne points currentIndex/currentSymbol at the retried row for the progress line', async () => {
    update.mockResolvedValueOnce(FAIL_PLACE_UNPROTECTED);
    await service.run([makeCandidate(), makeCandidate({ order: makeOrder({ orderId: 'o2' }) })], CTX);

    let observedSymbol = '';
    submit.mockImplementationOnce(async () => {
      observedSymbol = service.currentSymbol();
      return PLACE_OK;
    });
    await service.retryOne(service.results()[0]);

    expect(observedSymbol).toBe('AAPL');
    expect(service.currentIndex()).toBe(-1); // reset on settle
    expect(service.results()[0].status).toBe('updated');
  });

  it('reset() clears a settled run — a reopened dialog cannot inherit stale outcomes', async () => {
    await service.run([makeCandidate()], CTX);
    expect(service.status()).toBe('done');

    service.reset();

    expect(service.results()).toEqual([]);
    expect(service.status()).toBe('idle');
    expect(service.currentIndex()).toBe(-1);
  });

  it('a failed place-phase row with no retained ticket is not retryable — the dead path must not offer a doomed retry', () => {
    // Constructed directly: ensureTicket normally guarantees a ticket, so
    // this state is only reachable via the rePlace dead-path settle.
    const outcome = {
      candidate: makeCandidate(),
      status: 'failed' as const,
      result: {
        success: false as const,
        phase: 'place' as const,
        unprotected: true,
        error: { message: 'no ticket', retryable: false },
      },
    };

    expect(service.canRetry(outcome)).toBe(false);
  });
});
