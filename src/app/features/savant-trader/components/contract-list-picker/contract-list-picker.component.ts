/**
 * Contract List Picker (#1362 — rows tab + lines preview).
 *
 * The selection dialog over the page-scoped contract-list session:
 * a provenance header, a rows tab (per-row checkboxes, toolbar ops —
 * all/none/invert/stride/random/range/filter — disabled no-selection
 * markers, ↻ repeat badges), and a lines preview that mirrors
 * `store.emittedLines()` exactly. Send calls `store.sendSelected()` and
 * forwards the lines through the page's `onSend` callback — the dialog
 * stays open while the textarea + loadPlotted path runs behind it.
 * FE-4 (#1363) inserts the stepper tab between Rows and Lines.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../shared/ds/ds-dialog';

import type { NoSelectionReason } from '@options-replay/contracts';
import { DAYS } from '../../../shared/utils/date.util';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';

type PickerTab = 'rows' | 'lines';

/** Dialog-data contract — the page injects the emit callback so Send
 *  can plot without closing. */
export interface ContractListPickerData {
  onSend?: (lines: string[]) => void;
}

@Component({
  selector: 'app-contract-list-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contract-list-picker.component.html',
  styleUrl: './contract-list-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractListPickerComponent {
  protected readonly dialogRef = inject(DsDialogRef<ContractListPickerComponent>);
  /** Emit callback injected by the page — Send stays open, so the handoff
   *  is an explicit call rather than a close-result. Optional: the dialog
   *  still emits to `lastEmitted` when no callback is wired (tests). */
  private readonly data = inject<ContractListPickerData>(DS_DIALOG_DATA, {
    optional: true,
  });
  /** The page-scoped session — resolved from the opener's injector. */
  readonly store = inject(ContractListSessionStore);

  readonly canSend = computed(() => this.store.selectedRows().length > 0);
  /** Exact emit output for the current selection — the Lines tab body. */
  readonly linesText = computed(() => this.store.emittedLines().join('\n'));
  readonly rows = computed(() => this.store.activeList()?.rows ?? []);

  readonly activeTab = signal<PickerTab>('rows');

  // One-shot toolbar params — control values, not feature state (the
  // selection they produce lives in the store).
  readonly strideK = signal(2);
  readonly strideOptions = [2, 3, 5, 10, 20];
  readonly randomN = signal(10);
  readonly rangeFrom = signal('');
  readonly rangeTo = signal('');
  readonly filterText = signal('');
  readonly copied = signal(false);

  /** Emit the selection — `sendSelected` records `lastEmitted` and
   *  returns the lines; the page's `onSend` callback writes the textarea
   *  + loadPlotted. The dialog stays open. */
  send(): void {
    if (!this.canSend()) return;
    const lines = this.store.sendSelected();
    this.data?.onSend?.(lines);
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.linesText());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard denied (permissions/insecure context) — no-op is the
      // right UX for a convenience button; the preview stays selectable.
    }
  }

  applyStride(): void {
    this.store.selectStride(this.strideK());
  }

  applyRandom(): void {
    if (this.randomN() < 1) return;
    this.store.randomPick(this.randomN());
  }

  applyRange(): void {
    if (!this.rangeFrom() || !this.rangeTo()) return;
    this.store.selectDateRange(this.rangeFrom(), this.rangeTo());
  }

  applyFilter(): void {
    const text = this.filterText().trim();
    if (text) this.store.selectContains(text);
  }

  onToggle(entryDate: string, event: Event): void {
    this.store.toggleRow(entryDate, (event.target as HTMLInputElement).checked);
  }

  dow(iso: string): string {
    return DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  }

  noSelectionLabel(reason?: NoSelectionReason): string {
    switch (reason) {
      case 'miss': return 'No pick — chain existed, nothing met the criteria (miss)';
      case 'gap': return 'No pick — market data gap (gap)';
      case 'out-of-range': return 'No pick — outside the doc window (out-of-range)';
      default: return 'No pick';
    }
  }

  /** WAI-ARIA tabs keyboard nav: arrows move + activate, Home/End jump.
   *  The tab order is read off the DOM ids (`picker-tab-{name}`) so a
   *  tab added to the template joins the nav without touching this
   *  handler — a hardcoded array and the template could drift apart. */
  onTabKeydown(event: KeyboardEvent): void {
    const tabs = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.tab'),
    );
    const count = tabs.length;
    if (count === 0) return;
    const order = tabs.map((t) => t.id.replace(/^picker-tab-/, '') as PickerTab);
    let next: number | null = null;
    const current = order.indexOf(this.activeTab());
    switch (event.key) {
      case 'ArrowRight': next = (current + 1) % count; break;
      case 'ArrowLeft': next = (current - 1 + count) % count; break;
      case 'Home': next = 0; break;
      case 'End': next = count - 1; break;
      default: return;
    }
    event.preventDefault();
    this.activeTab.set(order[next]);
    tabs[next]?.focus();
  }
}
