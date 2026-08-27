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
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';

import { TradingConfig, AccountInfo } from '../../services/order-intent.types';
import { TradingConfigService } from '../../services/trading-config.service';

@Component({
  selector: 'app-trading-config-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Trading Settings</h2>
    <mat-dialog-content>
      @if (accountsLoading()) {
        <p class="loading-text">Loading accounts…</p>
      } @else {
        <div class="config-form">
          <mat-form-field appearance="outline" class="field-sm">
            <mat-label>Account</mat-label>
            <mat-select [(ngModel)]="form.accountNumber">
              @for (acct of accounts(); track acct.accountNumber) {
                <mat-option [value]="acct.accountNumber">
                  {{ acct.accountNumber }} ({{ acct.accountType }})
                </mat-option>
              }
            </mat-select>
          </mat-form-field>

          <div class="form-row">
            <mat-form-field appearance="outline" class="field-sm">
              <mat-label>Default $ / Trade</mat-label>
              <input matInput type="number" [(ngModel)]="form.defaultDollarAmount" placeholder="100" />
            </mat-form-field>

            <mat-form-field appearance="outline" class="field-sm">
              <mat-label>Max Units</mat-label>
              <input matInput type="number" [(ngModel)]="form.maxUnits" placeholder="200" />
            </mat-form-field>
          </div>

          <div class="form-row">
            <mat-form-field appearance="outline" class="field-sm">
              <mat-label>Max Allocation %</mat-label>
              <input matInput type="number" [(ngModel)]="form.maxAllocationPercent" placeholder="80" />
            </mat-form-field>
          </div>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
      <button mat-flat-button color="primary" (click)="save()" [disabled]="accountsLoading()">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .config-form { display: flex; flex-direction: column; gap: 12px; padding-top: 8px; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .field-sm {
      flex: 1 1 180px;
      min-width: 140px;
      font-size: 13px;
      ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
      ::ng-deep .mat-mdc-form-field-flex { min-height: 40px; height: 40px; }
      ::ng-deep .mat-mdc-form-field-infix { min-height: 28px; padding-top: 8px; padding-bottom: 8px; }
      ::ng-deep .mat-mdc-floating-label { font-size: 13px; }
      ::ng-deep .mat-mdc-input-element { font-size: 13px; }
    }
    .loading-text { padding: 16px 0; color: var(--mat-sys-on-surface-variant); font-size: 13px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TradingConfigDialogComponent implements OnInit {
  private readonly configService = inject(TradingConfigService);
  private readonly dialogRef = inject(MatDialogRef<TradingConfigDialogComponent>);
  readonly data = inject(MAT_DIALOG_DATA, { optional: true }) as TradingConfig | null;

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
