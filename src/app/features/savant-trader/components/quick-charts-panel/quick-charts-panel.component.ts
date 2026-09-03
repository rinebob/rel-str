/**
 * Quick Charts Panel
 *
 * Thin wrapper around app-quick-charts with a symbol meta header and placeholder.
 */
import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { QuickChartsComponent } from '../quick-charts/quick-charts.component';
import { StSymbolProfile } from '../../services/types';

@Component({
  selector: 'app-quick-charts-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, QuickChartsComponent],
  templateUrl: './quick-charts-panel.component.html',
  styleUrl: './quick-charts-panel.component.scss',
})
export class QuickChartsPanelComponent {
  symbol = input<string | null>(null);
  profile = input<StSymbolProfile | null>(null);

  /** Human-readable market cap tier label. */
  marketCapLabel = computed(() => {
    const cap = this.profile()?.marketCap;
    if (!cap) return '';
    if (cap >= 200_000_000_000) return 'MEGA';
    if (cap >= 10_000_000_000) return 'LARGE';
    if (cap >= 2_000_000_000) return 'MID';
    if (cap >= 300_000_000) return 'SMALL';
    return 'MICRO';
  });
}
