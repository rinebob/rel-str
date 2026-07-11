/**
 * Indicator Menu
 *
 * Compact menu for toggling chart indicators. The active chart interval is
 * shown as a badge on the trigger button.
 */
import { Component, ChangeDetectionStrategy, DestroyRef, inject, input, output, signal, effect } from '@angular/core';
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
  private readonly destroyRef = inject(DestroyRef);

  /** Indicator options to render as checkboxes in the menu. */
  options = input.required<IndicatorOption[]>();
  /** Set of currently selected indicator IDs — drives checkbox checked state. */
  selectedIds = input.required<Set<string>>();
  /** Short interval label shown as a badge on the trigger button (e.g. 'D', 'W', 'M'). */
  activeChartBadge = input<string>('D');

  /** Emits the batch of toggled IDs after the debounce window closes. */
  toggle = output<string[]>();

  /** Accumulator for the current debounce batch — collects distinct IDs touched within the window. */
  private pendingIds = new Set<string>();
  /** Handle for the active debounce timer; null when no batch is in flight. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Optimistic overrides — IDs whose visual state has been flipped locally but whose
   *  debounce batch has not yet been emitted to the parent. Cleared per-ID as `selectedIds`
   *  catches up so the checkbox never shows a stale state after the parent updates.
   */
  private optimisticOverrides = signal(new Set<string>());

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    });
    // When selectedIds changes (parent applied the toggle), clear any overrides for
    // IDs that are now in sync so the authoritative state takes over.
    effect(() => {
      this.selectedIds();
      const overrides = this.optimisticOverrides();
      if (overrides.size === 0) return;
      const stillPending = [...overrides].filter(id => this.pendingIds.has(id));
      if (stillPending.length !== overrides.size) {
        this.optimisticOverrides.set(new Set(stillPending));
      }
    });
  }

  /** Whether the given indicator is currently selected — applies optimistic override
   *  immediately so the checkbox flips on click without waiting for the debounce.
   */
  isSelected(id: string): boolean {
    const overridden = this.optimisticOverrides().has(id);
    const confirmed = this.selectedIds().has(id);
    return overridden ? !confirmed : confirmed;
  }

  /** Flip the checkbox immediately (optimistic), accumulate the ID for 300 ms,
   *  then emit the full batch to the parent. The parent's `onToggleIndicator` reads
   *  current selection state atomically and applies the correct toggle.
   */
  onToggle(id: string): void {
    this.optimisticOverrides.update(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    this.pendingIds.add(id);
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const ids = [...this.pendingIds];
      this.pendingIds.clear();
      if (ids.length > 0) this.toggle.emit(ids);
    }, 300);
  }
}
