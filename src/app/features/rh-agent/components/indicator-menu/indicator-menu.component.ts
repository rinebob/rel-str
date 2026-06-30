/**
 * Indicator Menu
 *
 * Compact menu for toggling chart indicators. The active chart interval is
 * shown as a badge on the trigger button.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { IndicatorOption } from '../../../shared/components/flex-chart/flex-chart.types';

@Component({
  selector: 'app-indicator-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatMenuModule],
  templateUrl: './indicator-menu.component.html',
  styleUrl: './indicator-menu.component.scss',
})
export class IndicatorMenuComponent {
  options = input.required<IndicatorOption[]>();
  selectedIds = input.required<Set<string>>();
  activeChartBadge = input<string>('D');

  toggle = output<string>();

  /** Whether the given indicator is currently selected. */
  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  /** Emit a toggle event for the given indicator. */
  onToggle(id: string): void {
    this.toggle.emit(id);
  }
}
