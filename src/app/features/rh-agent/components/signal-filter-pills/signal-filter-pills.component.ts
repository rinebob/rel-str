/**
 * Signal Filter Pills
 *
 * Compact pill-style toggle group for timeframe and direction filters.
 * Reusable across signal-review views.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignalTimeframe, SignalDirection } from '../../common/rh-agent.constants';

@Component({
  selector: 'app-signal-filter-pills',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './signal-filter-pills.component.html',
  styleUrl: './signal-filter-pills.component.scss',
})
export class SignalFilterPillsComponent {
  /** Currently selected timeframe filter. */
  timeframe = input<SignalTimeframe>(SignalTimeframe.ALL);

  /** Currently selected direction filter. */
  direction = input<SignalDirection>(SignalDirection.ALL);

  /** Expose enum values to the template. */
  readonly SignalTimeframe = SignalTimeframe;
  readonly SignalDirection = SignalDirection;

  /** Emitted when the user selects a different timeframe. */
  timeframeChange = output<SignalTimeframe>();

  /** Emitted when the user selects a different direction. */
  directionChange = output<SignalDirection>();
}
