/**
 * Signal Table
 *
 * Displays filtered historical signal markers for the signal-history page.
 */
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignalMarker, SignalDirection } from '../../../shared/components/flex-chart/signals/signal.types';
import { StIndicator } from '../../../shared/components/flex-chart/flex-chart.types';

export interface SignalTableRow extends SignalMarker {
  timeframe: string;
}

@Component({
  selector: 'app-signal-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './signal-table.component.html',
  styleUrl: './signal-table.component.scss',
})
export class SignalTableComponent {
  readonly StIndicator = StIndicator;
  readonly SignalDirection = SignalDirection;
  signals = input.required<SignalTableRow[]>();

  formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  trackBy(index: number, row: SignalTableRow): string {
    return row.x.getTime() + row.source + row.signalType + row.timeframe;
  }
}
