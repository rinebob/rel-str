/**
 * Symbol Review page — the signal-selection pane's shell (#553/#1117,
 * task #1653 shell + picker; #1654 occurrence list + toggles).
 *
 * Chart-view-style two-pane layout: a left symbol picker bound to the
 * review queue (one row per symbol with an un-groomed signal; a dot marks
 * `lastDailySignalDate > lastOpenedAt`) and a right detail pane whose
 * occurrence list + chart land in Phases 2–3. Selecting a symbol fires
 * `getSignalReviewBundle`, which stamps `lastOpenedAt[symbol]` server-side
 * — every select is a deliberate re-open that advances the divider.
 */
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
} from '@angular/core';

import { SignalReviewStore } from '../../stores/signal-review.store';
import { OccurrenceListComponent } from './occurrence-list.component';
import type { SignalReviewOccurrence } from '@paper-trading/contracts';

@Component({
  selector: 'app-symbol-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OccurrenceListComponent],
  templateUrl: './symbol-review.component.html',
  styleUrl: './symbol-review.component.scss',
})
export class SymbolReviewComponent implements OnInit {
  readonly store = inject(SignalReviewStore);

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
