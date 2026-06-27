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
  readonly BarsInterval = BarsInterval;

  selectedInterval = input.required<BarsInterval>();
  selectedRange = input.required<'recent' | '6m' | '1y' | '5y' | 'all'>();
  showZoomToolbar = input.required<boolean>();
  activeChartInterval = input.required<BarsInterval>();
  layout = input.required<'single' | 'triple'>();
  fullscreen = input.required<boolean>();
  indicatorOptions = input.required<IndicatorOption[]>();
  selectedIndicatorIds = input.required<Set<string>>();

  intervalChange = output<BarsInterval>();
  rangeChange = output<'recent' | '6m' | '1y' | '5y' | 'all'>();
  zoomToggle = output<void>();
  layoutToggle = output<void>();
  fullscreenToggle = output<void>();
  indicatorToggle = output<string>();
}
