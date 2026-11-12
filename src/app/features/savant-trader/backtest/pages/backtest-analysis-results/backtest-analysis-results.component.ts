/**
 * Backtest Analysis Results Page
 *
 * Route target for a contract list's analysis results
 * (`/options/strategy/backtest/analysis/:listDocId`). Streams the
 * `{listDocId}_{exitId}` result docs and renders the exit-event matrix:
 * a per-exit-type aggregate table in registry order + per-contract event
 * rows filterable by exit type (#1377 — the route shell landed in #1376;
 * #1431 added the open outcome, header context, row metrics, outcome
 * chips, wins/losses, capital/ROC, back nav, and per-rule chart send).
 */
import { Component, ChangeDetectionStrategy, computed, inject, effect } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { AnalysisResultsStore, type OutcomeFilter } from '../../stores/analysis-results.store';
import { formatBacktestTimestamp } from '../../utils/backtest.utils';
import { stOptionsAnalysisResultDocId } from '@st/collections';
import { AppRoutes } from '../../../../../core/common/interfaces';
import type { AnalysisOutcome } from '@options-analysis/contracts';

@Component({
  selector: 'app-backtest-analysis-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, PercentPipe, RouterLink],
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

  /** Headline — symbol + friendly template name (item 5) + positions
   *  count (item 4) + the run's requested start date. */
  readonly headline = computed(() => {
    const doc = this.store.docs()[0];
    if (!doc) return '';
    const parts = [doc.symbol, this.store.templateName() || doc.templateId];
    const n = this.store.positionCount();
    if (n != null) parts.push(`${n} positions`);
    const start = this.store.startDate();
    if (start) parts.push(`from ${start}`);
    return parts.join(' · ');
  });

  /** PT-formatted analyzed stamp — feature timestamp convention. */
  readonly analyzedAt = computed(() => formatBacktestTimestamp(this.store.analyzedAt()));

  /** Back nav (item 11) + the option-chart deep link base (item 12). */
  readonly backLink = `/${AppRoutes.STRATEGY_BACKTEST}`;
  readonly chartPath = `/${AppRoutes.OPTION_CHART}`;

  /** Outcome chip options (item 9) — 'all' + every AnalysisOutcome. The
   *  Record map is exhaustive: a new outcome variant fails to compile
   *  until its chip label lands here. */
  readonly outcomeOptions: readonly { id: OutcomeFilter; label: string }[] = [
    { id: 'all', label: 'All outcomes' },
    ...(
      Object.entries({
        exit: 'Exit',
        expired: 'Expired',
        open: 'Open',
        error: 'Error',
      } satisfies Record<AnalysisOutcome, string>) as [AnalysisOutcome, string][]
    ).map(([id, label]) => ({ id, label })),
  ];

  constructor() {
    // The store lifecycle is keyed on the route param — rebind when it changes.
    effect(() => {
      const id = this.listDocId();
      if (id) this.store.watchList(id);
    });
  }

  /** Per-rule chart send (item 12): the result doc's own id —
   *  `{listDocId}_{exitId}` — is the deep-link payload. */
  chartQuery(exitId: string): Record<string, string> {
    return { results: stOptionsAnalysisResultDocId(this.listDocId(), exitId) };
  }
}
