/**
 * RH Select Menu
 *
 * Generic single-select dropdown built on mat-stroked-button + mat-menu.
 * Renders a compact trigger button showing a label and the active selection,
 * with a checkbox-style menu matching the shared rh-dropdown-menu-item style.
 */
import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

export interface RhSelectOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-rh-select-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatMenuModule],
  templateUrl: './rh-select-menu.component.html',
  styleUrl: './rh-select-menu.component.scss',
})
export class RhSelectMenuComponent {
  /** Short label shown above the active value on the trigger button (e.g. 'Group', 'List'). */
  label = input.required<string>();
  /** Full list of selectable options. */
  options = input.required<RhSelectOption[]>();
  /** Currently selected value — drives the active checkmark and trigger display. */
  value = input.required<string>();

  /** Emits the newly selected value when the user picks an option. */
  valueChange = output<string>();

  readonly activeLabel = computed(() =>
    this.options().find(o => o.value === this.value())?.label
  );
}
