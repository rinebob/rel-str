/**
 * ModifyOrderDialogComponent — collects a new limit price for a
 * cancel-and-replace modify on an open equity limit order.
 * Returns the new price (number) on confirm, or undefined on dismiss.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../shared/ds/ds-dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

export interface ModifyOrderDialogData {
  order: BrokerOrder;
  /** Current mark for the symbol, when a quote is available. */
  markPrice: number | null;
}

@Component({
  selector: 'app-pd-modify-order-dialog',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 class="title">Modify {{ data.order.symbol }} order</h2>
    <div class="content">
      <p class="mod-context">
        {{ data.order.side }} {{ data.order.type }} · current limit
        {{ data.order.price != null ? ('$' + data.order.price.toFixed(2)) : '—' }}
        @if (data.markPrice; as m) {
          · mark {{ '$' + m.toFixed(2) }}
        }
      </p>
      <label class="dse-field mod-field">
        <span class="field-label">New limit price</span>
        <input class="field-input"
          type="number"
          step="0.01"
          min="0.01"
          [ngModel]="price()"
          (ngModelChange)="price.set($event)"
          data-testid="modify-price-input"
        />
        <span class="field-affix">$&nbsp;</span>
      </label>
      <p class="mod-note">The existing order is cancelled and a new limit order is placed.</p>
    </div>
    <div class="actions">
      <button class="ds-btn outline" (click)="ref.close()">Back</button>
      <button class="ds-btn fill"
 
 [disabled]="!valid()"
 (click)="ref.close(price())"
 cdkFocusInitial
 data-testid="modify-confirm"
 >
        Cancel &amp; Replace
      </button>
    </div>
  `,
  styles: `
    .mod-context { color: var(--mat-sys-on-surface-variant); font-size: 0.85rem; margin: 0 0 12px; }
    .mod-field { width: 100%; }
    .mod-note { color: var(--mat-sys-on-surface-variant); font-size: 0.8rem; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModifyOrderDialogComponent {
  readonly data = inject(DS_DIALOG_DATA) as ModifyOrderDialogData;
  protected readonly ref = inject(DsDialogRef<ModifyOrderDialogComponent, number>);

  /** New limit price — initialized to the order's current limit. */
  readonly price = signal<number | null>(this.data.order.price);

  readonly valid = computed(() => {
    const p = this.price();
    // Same-price modify burns a cancel + the order's queue priority for a no-op.
    return p != null && Number.isFinite(p) && p > 0 && p !== this.data.order.price;
  });
}
