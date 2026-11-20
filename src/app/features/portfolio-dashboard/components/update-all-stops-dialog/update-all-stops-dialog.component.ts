/**
 * Audit Stops Dialog — peak-exposure audit + batch tighten (#890).
 *
 * Steps: (1) max-giveback input (validated — a cleared/invalid value
 * gates Audit); (2) audit preview — one row per updatable stop showing
 * the position's peak since entry, current stop, exposure%, and the
 * proposed floor `peak × (1 − giveback)` for rows exposed beyond the
 * giveback; (3) run view rendering UpdateAllStopsService signals live —
 * the same view becomes the summary with per-order retry on rows the
 * contract allows via `svc.canRetry`.
 *
 * The audit semantics: `exposure = (peak − stop) / peak`. A stop below
 * `peak × (1 − giveback)` is by definition exposed by more than the
 * giveback — "exposed" and "needs tightening" are the same test, so the
 * batch can never loosen a stop.
 *
 * The run lives in the injected UpdateAllStopsService (providedIn root) so
 * its signals are the single source of progress; the dialog only renders.
 * Closing with `true` reports "orders may have changed" — the dashboard
 * reconciles the orders batch.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe } from '@angular/common';

import {
  DS_DIALOG_DATA,
  DsDialogRef,
} from '../../../../shared/ds/ds-dialog';
import { BrokerOrder } from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';
import type { EquityPositionWithPnL } from '../../portfolio-dashboard.types';
import type { PositionPeak } from '../../utils/position-peak.util';
import {
  StopUpdateCandidate,
  computeStopUpdateCandidates,
} from '../../utils/portfolio-pnl.util';
import {
  StopUpdateOutcome,
  UpdateAllStopsService,
} from '../../services/update-all-stops.service';

export interface UpdateAllStopsDialogData {
  accountNumber: string;
  /** Selected account's equity positions — the updatable-stop gate needs
   *  the long-position check. */
  positions: EquityPositionWithPnL[];
  /** Selected account's live orders — the updatable-stop set is filtered
   *  from these (same gate as the per-row Update Stop). */
  orders: BrokerOrder[];
  /** Per-symbol peak records (#1413) — the audit anchor is each
   *  position's `lifetime` peak (highest day-bar high since entry).
   *  Symbols without a derivable peak audit as 'skip-no-peak'. */
  peaks?: Record<string, PositionPeak> | null;
  /** True while any covered symbol's peak is still deriving — running
   *  the audit now would report every such row 'skip-no-peak' under a
   *  misleading "within giveback" banner, so Audit is gated on it. */
  peaksPending?: boolean;
}

@Component({
  selector: 'app-update-all-stops-dialog',
  standalone: true,
  imports: [FormsModule, CurrencyPipe],
  templateUrl: './update-all-stops-dialog.component.html',
  styleUrl: './update-all-stops-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdateAllStopsDialogComponent {
  readonly data = inject<UpdateAllStopsDialogData>(DS_DIALOG_DATA);
  readonly ref = inject<DsDialogRef<UpdateAllStopsDialogComponent, boolean>>(DsDialogRef);
  readonly svc = inject(UpdateAllStopsService);

  readonly step = signal<'input' | 'preview' | 'results'>('input');
  /** Default 8% — the desk's typical trailing-stop giveback. ngModel
   *  emits `number | null` for a cleared number input — null must fail
   *  validation, not silently compute a 0% giveback (a stop AT peak
   *  fills on the first downtick). */
  readonly givebackPct = signal<number | null>(8);
  /** A usable giveback: finite, positive, and below a sane 90% cap. */
  readonly givebackPctValid = computed(() => {
    const p = this.givebackPct();
    return p !== null && Number.isFinite(p) && p > 0 && p <= 90;
  });

  /** Snapshot taken when entering preview — the run operates on these
   *  rows even if the underlying orders reconcile mid-dialog. */
  readonly candidates = signal<StopUpdateCandidate[]>([]);
  readonly updateCount = computed(
    () => this.candidates().filter((c) => c.disposition === 'update').length,
  );
  readonly withinCount = computed(
    () => this.candidates().filter((c) => c.disposition === 'within-policy').length,
  );
  readonly skipCount = computed(
    () => this.candidates().filter((c) => c.disposition.startsWith('skip')).length,
  );

  /** Live-run bookkeeping the summary needs — a row actually attempted
   *  means broker state may have changed → close(true) reconciles. */
  readonly ranAny = computed(() =>
    this.svc.results().some((r) => r.status === 'updated' || r.status === 'failed'),
  );
  readonly settled = computed(() => {
    const s = this.svc.status();
    return s === 'done' || s === 'aborted';
  });
  /** Post-run tallies — the summary must say what actually happened:
   *  an aborted run may still have tightened earlier rows. */
  readonly resultCounts = computed(() => {
    const rs = this.svc.results();
    return {
      tightened: rs.filter((r) => r.status === 'updated').length,
      failed: rs.filter((r) => r.status === 'failed').length,
      notRun: rs.filter((r) => r.status === 'not-run').length,
    };
  });

  onPreview(): void {
    const p = this.givebackPct();
    if (!this.givebackPctValid() || p === null || this.data.peaksPending) return;
    this.svc.reset();
    this.candidates.set(
      computeStopUpdateCandidates(
        this.data.positions,
        this.data.orders,
        this.data.peaks ?? {},
        p,
      ),
    );
    this.step.set('preview');
  }

  onBack(): void {
    this.step.set('input');
  }

  async onConfirm(): Promise<void> {
    this.ref.disableClose = true;
    this.step.set('results');
    await this.svc.run(this.candidates(), {
      accountNumber: this.data.accountNumber,
    });
  }

  onRetryOne(outcome: StopUpdateOutcome): void {
    this.svc.retryOne(outcome).catch(() => {});
  }

  onClose(): void {
    // true only when a broker attempt ran — reconcile orders; otherwise a
    // plain dismiss (preview only / all-skipped run) is a no-op close.
    this.ref.close(this.ranAny() ? true : undefined);
  }

  /** Preview-row label from the candidate's audit disposition. */
  dispositionLabel(c: StopUpdateCandidate): string {
    switch (c.disposition) {
      case 'update': return 'exposed — tighten';
      case 'within-policy': return 'within giveback';
      case 'skip-no-peak': return 'no peak';
      case 'skip-no-price': return 'no stop price';
      case 'skip-above-market': return 'above market';
    }
  }

  /** Results-row label — status first, then the skip/failure detail. */
  outcomeLabel(r: StopUpdateOutcome): string {
    switch (r.status) {
      case 'pending': return 'queued';
      case 'running': return 'updating…';
      case 'updated': return 'tightened';
      case 'skipped': return r.error ?? this.dispositionLabel(r.candidate);
      case 'failed': return r.unprotected ? 'failed — UNPROTECTED' : 'failed';
      case 'not-run': return 'not run';
    }
  }
}
