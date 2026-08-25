/**
 * Symbol Signal History
 *
 * Displays the signal history for a single symbol row, including loading,
 * empty, and populated states.
 */
import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SymbolRow } from '../../stores/group.store';
import { SignalStatus } from '../../common/constants';

@Component({
  selector: 'app-symbol-signal-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatProgressSpinnerModule],
  templateUrl: './symbol-signal-history.component.html',
  styleUrl: './symbol-signal-history.component.scss',
})
export class SymbolSignalHistoryComponent {
  row = input.required<SymbolRow>();
  readonly SignalStatus = SignalStatus;

  readonly recentSignals = computed(() =>
    (this.row().signals ?? []).slice(0, 10)
  );
}
