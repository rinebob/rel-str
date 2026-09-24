/**
 * Log Scale Pill
 *
 * Shared "Log Y-axis Yes/No" toggle pill used by every FlexChart host
 * (chart toolbar, quick-charts panel, swing-analysis header). Owns the
 * pill markup, active styling, aria-pressed, and tooltip so the three
 * former inline copies stay in sync.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-log-scale-pill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './log-scale-pill.component.html',
  styleUrl: './log-scale-pill.component.scss',
})
export class LogScalePillComponent {
  /** Current scale mode — true renders the pill active/"Yes". Defaults to the
   *  shared FlexChart default (log) so an unbound host never disagrees with
   *  the chart. */
  logScale = input<boolean>(true);
  /** Optional data-testid rendered on the inner button for specs. */
  testId = input<string | null>(null);

  /** Emits when the user clicks the pill — the host owns flipping its signal. */
  toggle = output<void>();
}
