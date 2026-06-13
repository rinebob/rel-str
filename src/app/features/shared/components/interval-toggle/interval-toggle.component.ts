import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { Timeframe } from '../../types/rs.interfaces';

@Component({
  selector: 'app-interval-toggle',
  standalone: true,
  imports: [MatButtonModule],
  templateUrl: './interval-toggle.component.html',
  styleUrls: ['./interval-toggle.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntervalToggleComponent {
  readonly value = input.required<Timeframe>();
  readonly valueChange = output<Timeframe>();

  readonly Interval = Timeframe;

  onSelect(interval: Timeframe): void {
    if (interval === this.value()) {
      return;
    }

    this.valueChange.emit(interval);
  }
}
