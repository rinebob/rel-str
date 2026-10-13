/**
 * ModifyOrderDialogComponent — collects a new limit price for a
 * cancel-and-replace modify on an open equity limit order.
 * Returns the new price (number) on confirm, or undefined on dismiss.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
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
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Modify {{ data.order.symbol }} order</h2>
    <mat-dialog-content>
      <p class="mod-context">
        {{ data.order.side }} {{ data.order.type }} · current limit
        {{ data.order.price != null ? ('$' + data.order.price.toFixed(2)) : '—' }}
        @if (data.markPrice != null) {
          · mark {{ '$' + data.markPrice!.toFixed(2) }}
        }
      </p>
      <mat-form-field appearance="outline" class="mod-field">
        <mat-label>New limit price</mat-label>
        <input
          matInput
          type="number"
          step="0.01"
          min="0.01"
          [ngModel]="price()"
          (ngModelChange)="price.set($event)"
          data-testid="modify-price-input"
        />
        <span matTextPrefix>$&nbsp;</span>
      </mat-form-field>
      <p class="mod-note">The existing order is cancelled and a new limit order is placed.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-stroked-button [mat-dialog-close]="undefined">Back</button>
      <button
        mat-flat-button
        [disabled]="!valid()"
        [mat-dialog-close]="price()"
        cdkFocusInitial
        data-testid="modify-confirm"
      >
        Cancel &amp; Replace
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .mod-context { color: var(--mat-sys-on-surface-variant); font-size: 0.85rem; margin: 0 0 12px; }
    .mod-field { width: 100%; }
    .mod-note { color: var(--mat-sys-on-surface-variant); font-size: 0.8rem; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModifyOrderDialogComponent {
  readonly data = inject(MAT_DIALOG_DATA) as ModifyOrderDialogData;

  /** New limit price — initialized to the order's current limit. */
  readonly price = signal<number | null>(this.data.order.price);

  readonly valid = computed(() => {
    const p = this.price();
    return p != null && Number.isFinite(p) && p > 0;
  });
}
