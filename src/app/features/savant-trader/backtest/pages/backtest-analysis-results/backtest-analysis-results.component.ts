/**
 * Backtest Analysis Results Page
 *
 * Route target for a contract list's analysis results
 * (`/options/strategy/backtest/analysis/:listDocId`). Streams the
 * `{listDocId}_{exitId}` result docs and renders the exit-event matrix:
 * a per-exit-type aggregate table in registry order + per-contract event
 * rows filterable by exit type (#1377 — the route shell landed in #1376).
 */
import { Component, ChangeDetectionStrategy, computed, inject, effect } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { AnalysisResultsStore } from '../../stores/analysis-results.store';
import { formatBacktestTimestamp } from '../../utils/backtest.utils';
import type { AnalysisTradeRecord } from '@options-analysis/contracts';

@Component({
  selector: 'app-backtest-analysis-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  providers: [AnalysisResultsStore],
  templateUrl: './backtest-analysis-results.component.html',
  styleUrl: './backtest-analysis-results.component.scss',
})
export class BacktestAnalysisResultsComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly store = inject(AnalysisResultsStore);

  readonly listDocId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('listDocId') ?? '')),
    { initialValue: '' }
  );

  /** Symbol/template for the header — denormalized on every doc. */
  readonly subject = computed(() => {
    const doc = this.store.docs()[0];
    return doc && (doc.symbol || doc.templateId)
      ? `${doc.symbol} · ${doc.templateId}`
      : '';
  });

  /** PT-formatted analyzed stamp — feature timestamp convention. */
  readonly analyzedAt = computed(() => formatBacktestTimestamp(this.store.analyzedAt()));

  constructor() {
    // The store lifecycle is keyed on the route param — rebind when it changes.
    effect(() => {
      const id = this.listDocId();
      if (id) this.store.watchList(id);
    });
  }

  /** Outcome cell text — narrowing lives in TS, not template branches. */
  outcomeText(t: AnalysisTradeRecord): string {
    if (t.outcome === 'exit') return `exit ${t.exitDate} @ ${t.exitPrice.toFixed(2)}`;
    if (t.outcome === 'expired') {
      return `expired ${t.expiredItm ? 'ITM' : 'OTM'} · ${t.assignmentDistancePct.toFixed(2)}% away`;
    }
    return `error: ${t.error}`;
  }
}
