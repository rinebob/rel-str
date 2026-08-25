/**
 * Quick Charts Panel
 *
 * Thin wrapper around app-quick-charts with a close button and placeholder.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QuickChartsComponent } from '../quick-charts/quick-charts.component';

@Component({
  selector: 'app-quick-charts-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule, QuickChartsComponent],
  templateUrl: './quick-charts-panel.component.html',
  styleUrl: './quick-charts-panel.component.scss',
})
export class QuickChartsPanelComponent {
  symbol = input<string | null>(null);
  close = output<void>();
}
