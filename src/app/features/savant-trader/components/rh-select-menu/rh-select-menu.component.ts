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

export interface RhSelectOption<T = string> {
  value: T;
  label: string;
  badges?: string[];
  description?: string;
}

export interface RhSelectOptionGroup<T = string> {
  label: string;
  options: RhSelectOption<T>[];
}

@Component({
  selector: 'app-rh-select-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './rh-select-menu.component.html',
  styleUrl: './rh-select-menu.component.scss',
})
export class RhSelectMenuComponent<T = string> {
  /** Short label shown above the active value on the trigger button (e.g. 'Group', 'List'). */
  label = input.required<string>();
  /** Ungrouped options rendered at the top (e.g. a 'show all' sentinel). */
  options = input<RhSelectOption<T>[]>([]);
  /** Grouped options, rendered with non-selectable group headers. */
  optionGroups = input<RhSelectOptionGroup<T>[]>([]);
  /** Currently selected value — drives the active checkmark and trigger display. */
  value = input.required<T>();

  /** Emits the newly selected value when the user picks an option. */
  valueChange = output<T>();

  readonly activeLabel = computed(() => {
    const all = [
      ...this.options(),
      ...this.optionGroups().flatMap((g) => g.options),
    ];
    return all.find((o) => o.value === this.value())?.label;
  });
}
