/**
 * Trading Config Dialog
 *
 * Editable form for the user's trading configuration: account number
 * (fetched from RH MCP), default dollar amount, max units, account value,
 * max allocation percent. Saved to the trading config Firestore doc.
 */
import { Component, inject, signal, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DS_DIALOG_DATA } from '../../../../shared/ds/ds-dialog';
import { DsDialogRef } from '../../../../shared/ds/ds-dialog';

import { TradingConfig, AccountInfo } from '../../services/order-ticket.types';
import { TradingConfigService } from '../../services/trading-config.service';

@Component({
  selector: 'app-trading-config-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h2 class="title">Trading Settings</h2>
    <div class="content">
      @if (accountsLoading()) {
        <p class="loading-text">Loading accounts…</p>
      } @else {
        <div class="config-form">
          <label class="dse-field field-sm">
            <span class="field-label">Account</span>
            <select class="field-input" [(ngModel)]="form.accountNumber">
              @for (acct of accounts(); track acct.accountNumber) {
                <option [ngValue]="acct.accountNumber">
                  {{ acct.accountNumber }} ({{ acct.accountType }})
                </option>
              }
            </select>
          </label>

          <div class="form-row">
            <label class="dse-field field-sm">
              <span class="field-label">Default $ / Trade</span>
              <input class="field-input" type="number" [(ngModel)]="form.defaultDollarAmount" placeholder="100" />
            </label>

            <label class="dse-field field-sm">
              <span class="field-label">Max Units</span>
              <input class="field-input" type="number" [(ngModel)]="form.maxUnits" placeholder="200" />
            </label>
          </div>

          <div class="form-row">
            <label class="dse-field field-sm">
              <span class="field-label">Max Allocation %</span>
              <input class="field-input" type="number" [(ngModel)]="form.maxAllocationPercent" placeholder="80" />
            </label>
          </div>
        </div>
      }
    </div>
    <div class="actions" align="end">
      <button class="ds-btn" (click)="cancel()">Cancel</button>
      <button class="ds-btn fill" (click)="save()" [disabled]="accountsLoading()">Save</button>
    </div>
  `,
  styles: [`
    .config-form { display: flex; flex-direction: column; gap: 12px; padding-top: 8px; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .field-sm {
      flex: 1 1 180px;
      min-width: 140px;
      font-size: 13px;

      --ds-field-height: 40px;
      .field-label { font-size: 13px; }
      .field-input { font-size: 13px; }
    }
    .loading-text { padding: 16px 0; color: var(--mat-sys-on-surface-variant); font-size: 13px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TradingConfigDialogComponent implements OnInit {
  private readonly configService = inject(TradingConfigService);
  private readonly dialogRef = inject(DsDialogRef<TradingConfigDialogComponent>);
  readonly data = inject(DS_DIALOG_DATA, { optional: true }) as TradingConfig | null;

  readonly accounts = signal<AccountInfo[]>([]);
  readonly accountsLoading = signal(true);

  form: {
    accountNumber: string;
    defaultDollarAmount: number | null;
    maxUnits: number | null;
    maxAllocationPercent: number | null;
  } = {
    accountNumber: this.data?.accountNumber ?? '',
    defaultDollarAmount: this.data?.defaultDollarAmount ?? 100,
    maxUnits: this.data?.maxUnits ?? 200,
    maxAllocationPercent: this.data?.maxAllocationPercent ?? 80,
  };

  async ngOnInit(): Promise<void> {
    try {
      const accounts = await this.configService.getAccounts();
      this.accounts.set(accounts);
      // If no account is selected yet, auto-select the first one
      if (!this.form.accountNumber && accounts.length > 0) {
        this.form.accountNumber = accounts[0].accountNumber;
      }
    } catch (err) {
      console.error('[TradingConfigDialog] Failed to load accounts:', err);
    } finally {
      this.accountsLoading.set(false);
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
    this.dialogRef.close({
      accountNumber: this.form.accountNumber,
      defaultDollarAmount: this.form.defaultDollarAmount,
      maxUnits: this.form.maxUnits,
      maxAllocationPercent: this.form.maxAllocationPercent,
    });
  }
}
