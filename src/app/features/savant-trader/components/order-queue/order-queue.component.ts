/**
 * Order Queue Component
 *
 * Left panel of the signal order screen. Lists all staged intents grouped
 * by status. Each row shows source badge, symbol, side, order type, quantity,
 * and status. Clicking a row selects it (emits intent id). Batch select with
 * checkboxes + remove action.
 *
 * Ref: IMPL-savant-trader-order-placement-fe.md §8 (Signal order screen)
 */
import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  OrderIntent,
  OrderIntentStatus,
  OrderSource,
  InstrumentType,
} from '../../services/order-intent.types';

interface StatusGroup {
  label: string;
  status: OrderIntentStatus[];
  intents: OrderIntent[];
  cssClass: string;
}

@Component({
  selector: 'app-order-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatCheckboxModule, MatButtonModule, MatTooltipModule],
  templateUrl: './order-queue.component.html',
  styleUrl: './order-queue.component.scss',
})
export class OrderQueueComponent {
  /** All intents to display in the queue. */
  intents = input<OrderIntent[]>([]);

  /** Currently selected intent id. */
  selectedId = input<string | null>(null);

  /** Emitted when a row is clicked. */
  intentSelected = output<string>();

  /** Emitted when the user batch-removes selected intents. */
  removeIntents = output<string[]>();

  /** Track selected checkbox state per intent id. */
  private checkedIds = signal<Set<string>>(new Set());

  /** Whether any checkboxes are checked (controls remove button visibility). */
  hasChecked = computed(() => this.checkedIds().size > 0);

  /** Intents grouped by status category, in display order. */
  groups = computed<StatusGroup[]>(() => {
    const all = this.intents();
    return [
      {
        label: 'Staged',
        status: [OrderIntentStatus.STAGED, OrderIntentStatus.READY],
        intents: all.filter((i) => i.status === OrderIntentStatus.STAGED || i.status === OrderIntentStatus.READY),
        cssClass: 'group-staged',
      },
      {
        label: 'Submitting',
        status: [OrderIntentStatus.SUBMITTING],
        intents: all.filter((i) => i.status === OrderIntentStatus.SUBMITTING),
        cssClass: 'group-submitting',
      },
      {
        label: 'Submitted',
        status: [OrderIntentStatus.SUBMITTED],
        intents: all.filter((i) => i.status === OrderIntentStatus.SUBMITTED),
        cssClass: 'group-submitted',
      },
      {
        label: 'Filled',
        status: [OrderIntentStatus.FILLED],
        intents: all.filter((i) => i.status === OrderIntentStatus.FILLED),
        cssClass: 'group-filled',
      },
      {
        label: 'Failed',
        status: [OrderIntentStatus.FAILED],
        intents: all.filter((i) => i.status === OrderIntentStatus.FAILED),
        cssClass: 'group-failed',
      },
      {
        label: 'Cancelled',
        status: [OrderIntentStatus.CANCELLED],
        intents: all.filter((i) => i.status === OrderIntentStatus.CANCELLED),
        cssClass: 'group-cancelled',
      },
    ].filter((g) => g.intents.length > 0);
  });

  /** Total count for header. */
  totalCount = computed(() => this.intents().length);

  /** Extract the display symbol from an intent (equity/etf: symbol, option: first leg symbol). */
  symbolFor(intent: OrderIntent): string {
    if (intent.instrumentType === InstrumentType.OPTION) {
      return intent.legs[0]?.symbol ?? '?';
    }
    return intent.symbol;
  }

  /** Short source badge text. */
  sourceBadge(intent: OrderIntent): string {
    switch (intent.source) {
      case OrderSource.SIGNAL_PIPELINE: return 'SIG';
      case OrderSource.MANUAL: return 'MAN';
      case OrderSource.POSITION_MANAGEMENT: return 'POS';
      default: return '???';
    }
  }

  /** Quantity display string. */
  quantityFor(intent: OrderIntent): string {
    if (intent.instrumentType === InstrumentType.OPTION) {
      return intent.quantity;
    }
    return intent.quantity ?? intent.dollarAmount ?? '—';
  }

  /** CSS class for status badge. */
  statusClass(intent: OrderIntent): string {
    return `status-${intent.status}`;
  }

  /** Row click handler. */
  onRowClick(intent: OrderIntent, event: Event): void {
    // Don't select when clicking the checkbox
    if ((event.target as HTMLElement).closest('mat-checkbox')) return;
    this.intentSelected.emit(intent.id);
  }

  /** Toggle checkbox for an intent. */
  toggleCheck(id: string, checked: boolean): void {
    this.checkedIds.update((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Check if an intent id is checked. */
  isChecked(id: string): boolean {
    return this.checkedIds().has(id);
  }

  /** Select all intents. */
  selectAll(): void {
    this.checkedIds.set(new Set(this.intents().map((i) => i.id)));
  }

  /** Clear all checkboxes. */
  clearSelection(): void {
    this.checkedIds.set(new Set());
  }

  /** Emit remove event for all checked intents. */
  removeChecked(): void {
    const ids = Array.from(this.checkedIds());
    if (ids.length === 0) return;
    this.removeIntents.emit(ids);
    this.checkedIds.set(new Set());
  }
}
