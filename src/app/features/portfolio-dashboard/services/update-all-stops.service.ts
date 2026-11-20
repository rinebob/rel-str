/**
 * @topic #219 — PORTFOLIO, Thread #829 (Update Stop Loss)
 * @task #890 — Update All Stops batch ratchet
 *
 * Sequential orchestrator for the peak-exposure batch audit. The dialog
 * only renders this service's signals — progress, per-order outcomes,
 * abort state all live here so a dismissed dialog doesn't lose the run.
 *
 * Per candidate with disposition 'update': buildStopLossUpdateTicket at
 * the computed floor — GTC always (the audit's replacement is
 * canonical), `marketHours` pinned regular (Robinhood rejects stop
 * orders outside regular hours — #886; every live stop necessarily
 * carries regular_hours already, so pinning preserves the reachable
 * marketHours set while hardening the unreachable one), the ORDER's own
 * whole-share quantity (like-for-like replacement — deliberate
 * divergence from the single-stop dialog, which tickets the full
 * truncated POSITION quantity and can oversell a same-symbol stop
 * ladder on trigger), `stop_loss_update` provenance — then
 * `updateEquityStopOrder` (cancel → confirm → bounded place).
 * Sequential, not parallel: the primitive is NOT reentrant per order and
 * a burst of cancels makes broker state harder to reason about mid-run.
 *
 * Any failure aborts the run — the IMPL's "unrecoverable" bar is met by
 * every failure since each leaves per-order broker ambiguity (a cancel
 * may have landed while its confirmation was lost). Continuing would
 * compound divergence; the summary's per-order `retryOne` is the manual
 * path forward. `status` reads 'aborted' until every row resolves to
 * updated/skipped — a permanently-failed row keeps the run honest about
 * not having finished.
 *
 * `retryOne` follows the primitive's caller contract (mirrors the
 * single-stop dialog's onRetry): cancel-phase → re-run the whole
 * primitive on the retained ticket while the cancel error is retryable;
 * place-phase + unprotected → re-place the RETAINED ticket via
 * submitEquityOrder (never re-cancel — nothing left to cancel);
 * PLACEMENT_DEAD mints a fresh refId (the dead placement likely
 * consumed it); place-phase + !unprotected → NOT retryable — a ref-id
 * conflict/unconfirmed ack means the replacement likely registered;
 * reconcile instead of risking a duplicate stop.
 */
import { Injectable, computed, inject, signal } from '@angular/core';

import { OrderExecutionService } from '../../savant-trader/services/order-execution.service';
import type {
  ExecutionResult,
  UpdateStopResult,
} from '../../savant-trader/services/order-execution.service';
import {
  asUpdatePlaceFailure,
  PLACEMENT_DEAD_CODE,
} from '../../savant-trader/services/order-execution.service';
import type { EquityOrderTicket } from '../../savant-trader/services/order-ticket.types';
import { buildStopLossUpdateTicket } from '../../savant-trader/utils/stop-loss-ticket.util';
import type { StopUpdateCandidate } from '../utils/portfolio-pnl.util';

export type StopUpdateRowStatus =
  | 'pending'
  | 'running'
  | 'updated'
  | 'skipped'
  | 'failed'
  | 'not-run';

/** One row of the batch run — the dialog renders this verbatim. */
export interface StopUpdateOutcome {
  candidate: StopUpdateCandidate;
  status: StopUpdateRowStatus;
  /** Broker-facing result when the primitive ran — success or failure. */
  result?: UpdateStopResult;
  /** Display error for failed/skipped rows that never got a result (e.g.
   *  fractional shares) or failed without a message. */
  error?: string;
  /** Forwarded `unprotected` flag — the summary highlights these rows. */
  unprotected?: boolean;
  /** The ticket submitted for this row — retained for the phase contract:
   *  place-phase retries re-place THIS ticket (same refId), only a
   *  PLACEMENT_DEAD retry mints a fresh one. */
  ticket?: EquityOrderTicket;
}

export interface UpdateAllStopsContext {
  accountNumber: string;
}

@Injectable({ providedIn: 'root' })
export class UpdateAllStopsService {
  private readonly orderExecution = inject(OrderExecutionService);

  readonly status = signal<'idle' | 'running' | 'done' | 'aborted'>('idle');
  readonly results = signal<StopUpdateOutcome[]>([]);
  readonly currentIndex = signal(-1);
  /** Symbol of the in-flight row — the progress line renders this instead
   *  of an index (indices count skipped rows and mislead). */
  readonly currentSymbol = computed(() => {
    const i = this.currentIndex();
    return i >= 0 ? (this.results()[i]?.candidate.symbol ?? '') : '';
  });

  /** Retained for `retryOne` — a retried row rebuilds from the same ctx. */
  private ctx: UpdateAllStopsContext | null = null;

  /** Whether a row can be retried — mirrors the single-stop dialog's
   *  canRetry contract so the summary only offers paths that can land. */
  canRetry(outcome: StopUpdateOutcome): boolean {
    if (outcome.status === 'not-run') return true;
    if (outcome.status !== 'failed') return false;
    const res = outcome.result;
    if (res?.phase === 'cancel') return res.error?.retryable ?? true;
    // place: re-place whenever the old stop is gone — the designed
    // recovery even when error.retryable is false (PLACEMENT_DEAD mints
    // a fresh refId) — but only with a retained ticket; the no-ticket
    // dead path must not offer a retry that deterministically re-fails.
    if (res?.phase === 'place')
      return res.unprotected === true && outcome.ticket != null;
    return res?.error?.retryable ?? true;
  }

  /** Run the batch sequentially. `pending` rows update in order; the first
   *  failure marks its row 'failed', the rest 'not-run', and stops. */
  async run(
    candidates: StopUpdateCandidate[],
    ctx: UpdateAllStopsContext,
  ): Promise<void> {
    if (this.status() === 'running') return;
    this.ctx = ctx;
    this.results.set(
      candidates.map((candidate) => {
        if (candidate.disposition !== 'update') {
          return { candidate, status: 'skipped' as const };
        }
        const wholeShares = Math.trunc(candidate.order.quantity ?? 0);
        return wholeShares > 0
          ? { candidate, status: 'pending' as const }
          : {
              candidate,
              status: 'skipped' as const,
              error: `Fractional quantity (${candidate.order.quantity}) — no whole shares to protect`,
            };
      }),
    );
    this.status.set('running');
    const rows = this.results();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].status !== 'pending') continue;
      this.currentIndex.set(i);
      let ok = false;
      try {
        ok = await this.runPrimitive(rows[i]);
      } catch {
        // Ticket-build or other pre-broker throw — treat like a failure:
        // the row fails, the rest go not-run, the loop stops. Without
        // this a sync throw strands status 'running' forever (the
        // singleton would reject every later run).
        ok = false;
      }
      if (!ok) {
        this.results.update((rs) =>
          rs.map((r, j) =>
            j > i && r.status === 'pending' ? { ...r, status: 'not-run' } : r,
          ),
        );
        this.status.set('aborted');
        this.currentIndex.set(-1);
        return;
      }
    }
    this.status.set('done');
    this.currentIndex.set(-1);
  }

  /** Clear a settled run — a reopened dialog starts clean instead of
   *  inheriting last run's outcomes (a stale 'updated' row would make
   *  the new dialog's close(true) fire a spurious reconcile). No-op
   *  while a run is in flight. */
  reset(): void {
    if (this.status() === 'running') return;
    this.results.set([]);
    this.status.set('idle');
    this.currentIndex.set(-1);
    this.ctx = null;
  }

  /** Re-run one failed/not-run row per the primitive's phase contract —
   *  the row is re-located live (a stale snapshot can't fire a call)
   *  and only paths the contract marks retryable proceed. */
  async retryOne(outcome: StopUpdateOutcome): Promise<void> {
    if (this.status() === 'running' || !this.ctx) return;
    const idx = this.results().findIndex((r) => r.candidate === outcome.candidate);
    const live = idx >= 0 ? this.results()[idx] : undefined;
    if (!live || !this.canRetry(live)) return;
    this.currentIndex.set(idx);
    this.status.set('running');
    try {
      const phase = live.result?.phase;
      if (live.status === 'not-run' || phase !== 'place') {
        // Never attempted, or the cancel itself failed → the old order
        // still rests (or was never touched) — the whole primitive is
        // the safe path; re-running cancel-first cannot duplicate.
        await this.runPrimitive(live);
      } else {
        // place + unprotected (canRetry gated): the old stop is gone —
        // re-place the retained ticket, never re-cancel.
        await this.rePlace(live);
      }
    } finally {
      // The run is 'done' only when every row carries a settled outcome —
      // a row left failed/not-run keeps 'aborted' (the ratchet honestly
      // did not complete).
      this.status.set(
        this.results().every(
          (r) => r.status === 'updated' || r.status === 'skipped',
        )
          ? 'done'
          : 'aborted',
      );
      this.currentIndex.set(-1);
    }
  }

  /** Ensure the row has a ticket, building it on first use — the same
   *  shape across run and retry (not-run rows never built one). */
  private ensureTicket(outcome: StopUpdateOutcome): EquityOrderTicket | null {
    if (outcome.ticket) return outcome.ticket;
    const { candidate } = outcome;
    if (candidate.computedStopPrice === null) {
      // Patch a result too — canRetry reads error.retryable from it;
      // without one the row would offer Retry forever on a failure that
      // deterministically repeats.
      this.patch(outcome, {
        status: 'failed',
        error: `No computed stop price for ${candidate.symbol}`,
        result: {
          success: false,
          phase: 'cancel',
          unprotected: false,
          error: {
            message: `No computed stop price for ${candidate.symbol}`,
            retryable: false,
          },
        },
      });
      return null;
    }
    const ticket = buildStopLossUpdateTicket(
      candidate.symbol,
      String(Math.trunc(candidate.order.quantity ?? 0)),
      candidate.computedStopPrice,
      this.ctx!.accountNumber,
      candidate.order.orderId,
      {
        timeInForce: 'gtc',
        marketHours: 'regular_hours',
      },
    );
    this.patch(outcome, { ticket });
    return ticket;
  }

  /** One candidate's full cancel→confirm→place — the run-loop and
   *  cancel-phase retry path. Returns false on failure so `run` aborts. */
  private async runPrimitive(outcome: StopUpdateOutcome): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return false;
    let ticket: EquityOrderTicket | null = null;
    try {
      ticket = this.ensureTicket(outcome);
    } catch (err) {
      // Deterministic build failure — not broker ambiguity and not
      // retryable; settling keeps the row honest (never stuck 'pending').
      this.settle(outcome, {
        success: false,
        phase: 'cancel',
        unprotected: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        },
      });
      return false;
    }
    if (!ticket) return false;
    this.patch(outcome, { status: 'running' });
    let res: UpdateStopResult;
    try {
      res = await this.orderExecution.updateEquityStopOrder(
        ctx.accountNumber,
        outcome.candidate.order.orderId,
        ticket,
      );
    } catch (err) {
      // Thrown (not a result): cancel-first fallback — re-running the
      // primitive can never duplicate since place didn't complete.
      res = {
        success: false,
        phase: 'cancel',
        unprotected: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        },
      };
    }
    return this.settle(outcome, res);
  }

  /** Place-phase retry — re-place the retained ticket only. The old stop
   *  is already gone; re-cancelling fails and a fresh full primitive
   *  would chase a phantom order. PLACEMENT_DEAD mints a fresh refId —
   *  the dead placement likely consumed the original (RH dedups onto
   *  the dead order otherwise). */
  private async rePlace(outcome: StopUpdateOutcome): Promise<void> {
    const base = outcome.ticket;
    if (!base) {
      // A place-phase outcome implies ensureTicket patched a ticket —
      // unreachable today, but a bare return would wedge the row at
      // 'running' forever. Settle it instead of silently dead-ending.
      this.settle(outcome, {
        success: false,
        phase: 'place',
        // unprotected:true is honest — the old stop is gone — and
        // canRetry still refuses: no ticket means nothing to re-place.
        unprotected: true,
        error: { message: 'No ticket to re-place', retryable: false },
      });
      return;
    }
    const ticket =
      outcome.result?.error?.code === PLACEMENT_DEAD_CODE
        ? { ...base, refId: crypto.randomUUID() }
        : base;
    this.patch(outcome, { status: 'running' });
    try {
      const res = await this.orderExecution.submitEquityOrder(ticket);
      this.settle(outcome, this.stampPlace(res));
    } catch (err) {
      this.settle(outcome, {
        success: false,
        phase: 'place',
        unprotected: true,
        error: {
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        },
      });
    }
  }

  /** Interpret a bare ExecutionResult from a re-place through the
   *  update-mode place-phase classifier — a ref-id conflict or
   *  unconfirmed ack means the replacement likely registered
   *  (unprotected:false → reconcile, never re-place). */
  private stampPlace(res: ExecutionResult): UpdateStopResult {
    return res.success ? { ...res, phase: 'place' } : asUpdatePlaceFailure(res);
  }

  /** Fold a broker result into the row. Returns success for the run
   *  loop's abort decision. */
  private settle(outcome: StopUpdateOutcome, res: UpdateStopResult): boolean {
    if (res.success) {
      this.patch(outcome, { status: 'updated', result: res });
      return true;
    }
    this.patch(outcome, {
      status: 'failed',
      result: res,
      error: res.error?.message ?? 'update failed',
      unprotected: res.unprotected ?? false,
    });
    return false;
  }

  private patch(outcome: StopUpdateOutcome, changes: Partial<StopUpdateOutcome>): void {
    // Match on the stable candidate — patching swaps the row object, so
    // identity on `outcome` itself only works for the first patch.
    this.results.update((rs) =>
      rs.map((r) =>
        r.candidate === outcome.candidate ? { ...r, ...changes } : r,
      ),
    );
  }
}
