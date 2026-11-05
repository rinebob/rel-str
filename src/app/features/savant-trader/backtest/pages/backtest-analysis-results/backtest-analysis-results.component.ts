/**
 * Backtest Analysis Results Page
 *
 * Route target for a contract list's analysis results
 * (`/options/strategy/backtest/analysis/:listDocId`). Task #1376 ships the
 * route shell only — the aggregate/event surface lands under #1377.
 */
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

@Component({
  selector: 'app-backtest-analysis-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './backtest-analysis-results.component.html',
  styleUrl: './backtest-analysis-results.component.scss',
})
export class BacktestAnalysisResultsComponent {
  private readonly route = inject(ActivatedRoute);

  readonly listDocId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('listDocId') ?? '')),
    { initialValue: '' }
  );
}
