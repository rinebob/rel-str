/**
 * Symbol Review page — the signal-selection pane's shell (#553/#1117,
 * task #1653 shell + picker; #1654 occurrence list + toggles; #1655
 * chart + occurrence markers).
 *
 * Chart-view-style two-pane layout: a left symbol picker bound to the
 * review queue (one row per symbol with an un-groomed signal; a dot marks
 * `lastDailySignalDate > lastOpenedAt`) and a right detail pane holding
 * the occurrence list beside chart-view's signal-detail stack. Selecting
 * a symbol fires `getSignalReviewBundle`, which stamps
 * `lastOpenedAt[symbol]` server-side — every select is a deliberate
 * re-open that advances the divider.
 *
 * The chart reuses `SignalDetailComponent` verbatim: `manualSymbol` drives
 * its bar/indicator loads, and the bundle's occurrences feed it as
 * `reviewMarkers` — checked rows solid, unchecked ghost — plotted at each
 * signal bar's close on the daily chart. `ChartToolbarStateService` is
 * page-scoped here exactly as it is on chart-view (the detail injects it).
 */
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
} from '@angular/core';

import { SignalReviewStore } from '../../stores/signal-review.store';
import { ChartStore } from '../../stores/chart.store';
import { ChartToolbarStateService } from '../../services/chart-toolbar-state.service';
import { OccurrenceListComponent } from './occurrence-list.component';
import { SignalDetailComponent } from '../../components/signal-detail/signal-detail.component';
import {
  occurrenceMarkersFromReview,
  type ChartScatterPoint,
} from '../../utils/chart-indicators';
import type { SignalReviewOccurrence } from '@paper-trading/contracts';

@Component({
  selector: 'app-symbol-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ChartToolbarStateService],
  imports: [OccurrenceListComponent, SignalDetailComponent],
  templateUrl: './symbol-review.component.html',
  styleUrl: './symbol-review.component.scss',
})
export class SymbolReviewComponent implements OnInit {
  readonly store = inject(SignalReviewStore);
  private readonly chartStore = inject(ChartStore);

  /** Occurrence dots for the daily chart — derived only from the bundle
   *  that owns the current selection (a kept bundle keyed to another
   *  symbol contributes nothing, matching the list's own guard). Bars
   *  come from ChartStore, which the detail component populates via its
   *  own `manualSymbol` effect; occurrences older than the cached range
   *  produce no point. */
  readonly reviewMarkers = computed<ChartScatterPoint[]>(() => {
    const b = this.store.bundle();
    // Both reads are symbol-keyed: the bundle guard keeps a kept bundle's
    // rows from plotting under a new selection, and the dataset guard keeps
    // the PREVIOUS symbol's bars (ChartStore holds them while the new
    // fetch is in flight) from supplying closes for this symbol's dates.
    const bars = this.chartStore.dailyData();
    if (!b || b.symbol !== this.store.selectedSymbol() || bars?.symbol !== b.symbol) {
      return [];
    }
    return occurrenceMarkersFromReview(b.occurrences, bars.bars);
  });

  ngOnInit(): void {
    void this.store.loadQueue();
    // Session store survives navigation — a retained selection is
    // re-opened deliberately so the bundle re-fetches and re-stamps
    // (silent staleness would show a ledger join the server has moved on).
    const retained = this.store.selectedSymbol();
    if (retained) void this.store.selectSymbol(retained);
  }

  onSymbolSelected(symbol: string): void {
    void this.store.selectSymbol(symbol);
  }

  onToggle(occ: SignalReviewOccurrence): void {
    void this.store.toggle(occ.occurrenceId);
  }
}
