/**
 * RH Select Menu
 *
 * Generic single-select dropdown built on mat-stroked-button + mat-menu.
 * Renders a compact trigger button showing a label and the active selection,
 * with a checkbox-style menu matching the shared rh-dropdown-menu-item style.
 */
import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface RhSelectOption {
  value: string;
  label: string;
  badges?: string[];
  description?: string;
}

export interface RhSelectOptionGroup {
  label: string;
  options: RhSelectOption[];
}

@Component({
  selector: 'app-rh-select-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './rh-select-menu.component.html',
  styleUrl: './rh-select-menu.component.scss',
})
export class RhSelectMenuComponent {
  /** Short label shown above the active value on the trigger button (e.g. 'Group', 'List'). */
  label = input.required<string>();
  /** Full list of selectable options. */
  options = input<RhSelectOption[]>([]);
  /** Grouped options, rendered with non-selectable group headers. */
  optionGroups = input<RhSelectOptionGroup[]>([]);
  /** Currently selected value — drives the active checkmark and trigger display. */
  value = input.required<string>();

  /** Emits the newly selected value when the user picks an option. */
  valueChange = output<string>();

  readonly activeLabel = computed(() => {
    const groupedOptions = this.optionGroups().flatMap(g => g.options);
    const allOptions = groupedOptions.length > 0 ? groupedOptions : this.options();
    return allOptions.find(o => o.value === this.value())?.label;
  });
}
