/**
 * Chart Toolbar
 *
 * Toolbar for the signal-detail chart: indicators menu, interval/range toggles,
 * layout switch, fullscreen, and zoom-toolbar toggle.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BarsInterval } from '../../../../core/models/partner.types';
import { ChartLayout } from '../../../../core/services/ui-state.service';
import { IndicatorOption } from '../../../shared/components/flex-chart/flex-chart.types';
import { IndicatorMenuComponent } from '../indicator-menu/indicator-menu.component';

@Component({
  selector: 'app-chart-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule, IndicatorMenuComponent],
  templateUrl: './chart-toolbar.component.html',
  styleUrl: './chart-toolbar.component.scss',
})
export class ChartToolbarComponent {
  /** Exposed for template comparisons — Angular templates cannot reference imported enums directly. */
  readonly BarsInterval = BarsInterval;
  readonly ChartLayout = ChartLayout;

  /** Currently selected chart interval (D/W/M). Controls which interval button appears active. */
  selectedInterval = input.required<BarsInterval>();
  /** Currently selected time-range preset. Controls which range button appears active. */
  selectedRange = input.required<'recent' | '6m' | '1y' | '5y' | 'all'>();
  /** Whether the Syncfusion zoom/pan toolbar is currently visible. */
  showZoomToolbar = input.required<boolean>();
  /** Interval of the chart whose indicator menu badge is highlighted as active. */
  activeChartInterval = input.required<BarsInterval>();
  /** Current chart layout mode — controls visibility of the layout toggle button icon. */
  layout = input.required<ChartLayout>();
  /** Whether the view is currently in fullscreen mode. */
  fullscreen = input.required<boolean>();
  /** Whether the price axis is using logarithmic scale. */
  logScale = input.required<boolean>();
  /** Indicator options to display in the indicator menu. */
  indicatorOptions = input.required<IndicatorOption[]>();
  /** Currently selected indicator IDs — drives checkbox state in the indicator menu. */
  selectedIndicatorIds = input.required<Set<string>>();

  /** Emits the chosen interval when the user clicks a D/W/M button. */
  intervalChange = output<BarsInterval>();
  /** Emits the chosen range preset when the user clicks a range button. */
  rangeChange = output<'recent' | '6m' | '1y' | '5y' | 'all'>();
  /** Emits when the user clicks the zoom/pan toolbar toggle button. */
  zoomToggle = output<void>();
  /** Emits when the user clicks the single/triple layout toggle button. */
  layoutToggle = output<void>();
  /** Emits when the user clicks the fullscreen toggle button. */
  fullscreenToggle = output<void>();
  /** Emits when the user clicks the log/linear scale toggle button. */
  logScaleToggle = output<void>();
  /** Emits the batch of toggled indicator IDs from the indicator menu's debounce window. */
  indicatorToggle = output<string[]>();
}
