/**
 * RH Select Menu
 *
 * Generic single-select dropdown built on ds-btn + ds-menu (signal-driven
 * panel inside the component DOM). Renders a compact trigger button showing
 * a label and the active selection.
 */
import { Component, ChangeDetectionStrategy, computed, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';


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
  imports: [NgTemplateOutlet],
  templateUrl: './rh-select-menu.component.html',
  styleUrl: './rh-select-menu.component.scss',
  host: { '(document:click)': 'menuOpen.set(false)' },
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
  /** Disables the trigger — placeholder dropdowns (e.g. the scan source
   *  before its cache exists, #1232) render inert until they go live. */
  disabled = input(false);

  /** Emits the newly selected value when the user picks an option. */
  valueChange = output<T>();

  readonly activeLabel = computed(() => {
    const all = [
      ...this.options(),
      ...this.optionGroups().flatMap((g) => g.options)];
    return all.find((o) => o.value === this.value())?.label;
  });

  /** ds-menu dropdown open state — selection closes the panel. */
  readonly menuOpen = signal(false);

  /** Trigger click — toggle the dropdown panel. */
  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen.update((v) => !v);
  }

  /** Option click — emit the new value and close the panel. */
  select(value: T): void {
    this.menuOpen.set(false);
    this.valueChange.emit(value);
  }
}
