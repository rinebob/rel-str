/**
 * AllocationPageComponent — the Allocation Manager page shell
 * (Blueprint #582 / task #588).
 *
 * Reuses the dashboard's account-tab pattern: one mat-tab per RH account
 * (ALL accounts — non-agentic ones are flagged, not filtered). Each tab
 * carries the account header (value / allocated / cash remainder +
 * divergence warning) and Buckets | Positions subtabs. Subtab contents are
 * minimal read-only tables here — the interactive table/dialog components
 * arrive in #589/#590/#591 and replace these placeholders.
 */
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AllocationStore } from './allocation.store';
import { fmtDollars } from './allocation.types';
import { AllocationBucketsTableComponent } from './allocation-buckets-table.component';
import { AllocationPositionsTableComponent } from './allocation-positions-table.component';

@Component({
  selector: 'app-allocation-page',
  imports: [RouterLink, MatTabsModule, MatTooltipModule, DatePipe,
    AllocationBucketsTableComponent, AllocationPositionsTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="allocation-page">
      @if (store.loadError(); as err) {
        <div class="error-banner" data-testid="load-error">{{ err }}</div>
      }

      <div class="page-toolbar">
        <a class="toolbar-btn back-link" routerLink="/portfolio" data-testid="back-to-portfolio">← Portfolio</a>
        <button data-testid="refresh-btn" type="button" class="toolbar-btn"
          [disabled]="store.selectedAllocation().loading"
          (click)="onRefresh()"
        >{{ store.selectedAllocation().loading ? 'Loading…' : 'Refresh' }}</button>
      </div>

      @if (!store.loadError() && store.accounts().length === 0) {
        <div class="loading" data-testid="accounts-loading">Loading accounts…</div>
      }

      <div data-testid="account-tabs">
        <mat-tab-group
          [selectedIndex]="store.selectedAccountIndex()"
          (selectedIndexChange)="onAccountTab($event)"
        >
          @for (acct of store.accounts(); track acct.accountNumber) {
            <mat-tab>
              <ng-template mat-tab-label>
                <span [attr.data-testid]="'acct-tab-' + acct.accountNumber">
                  {{ acct.accountName }} ({{ acct.accountNumber }})
                </span>
                @if (!acct.agenticAllowed) {
                  <span class="non-agentic" [attr.data-testid]="'non-agentic-flag-' + acct.accountNumber"
                    tabindex="0" role="note" aria-label="Non-agentic account — order placement not enabled"
                    matTooltip="Order placement is not enabled on this account — bucket management and assignment only"
                  >non-agentic</span>
                }
              </ng-template>

              @if (store.accountHeader(); as hdr) {
                <header class="account-header" data-testid="account-header">
                  <span>Account value: <b>{{ fmt(hdr.accountValue) }}</b></span>
                  <span>Allocated: <b>{{ fmt(hdr.allocated) }}</b></span>
                  <span>Cash: <b>{{ fmt(hdr.cash) }}</b>
                    @if (hdr.cashDiverged) {
                      <span class="diverged" data-testid="cash-diverged"
                        tabindex="0" role="img" aria-label="Cash divergence warning — broker vs derived mismatch"
                        matTooltip="Broker cash {{ fmt(hdr.cash) }} vs derived {{ fmt(hdr.derivedCash) }} — positions snapshot may be stale"
                      >⚠</span>
                    }
                  </span>
                  <span>Unassigned: <b>{{ fmt(hdr.unassignedExposure) }}</b></span>
                  @if (hdr.asOf) {
                    <span class="as-of" data-testid="as-of">as of {{ hdr.asOf | date:'short' }}</span>
                  }
                </header>
              }

              <mat-tab-group data-testid="subtabs" class="subtabs">
                <mat-tab>
                  <ng-template mat-tab-label><span data-testid="subtab-buckets">Buckets</span></ng-template>
                  @if (store.selectedAllocation().loading) {
                    <div data-testid="buckets-loading">Loading…</div>
                  } @else if (store.selectedAllocation().error; as err) {
                    <div class="error-banner" data-testid="account-error">{{ err }}</div>
                  } @else {
                    <app-allocation-buckets-table />
                  }
                </mat-tab>
                <mat-tab>
                  <ng-template mat-tab-label><span data-testid="subtab-positions">Positions</span></ng-template>
                  @if (store.selectedAllocation().loading) {
                    <div data-testid="positions-loading">Loading…</div>
                  } @else if (store.selectedAllocation().error; as err) {
                    <div class="error-banner" data-testid="account-error">{{ err }}</div>
                  } @else {
                    <app-allocation-positions-table />
                  }
                </mat-tab>
              </mat-tab-group>
            </mat-tab>
          }
        </mat-tab-group>
      </div>
    </div>
  `,
  styles: [`
    .allocation-page { padding: 12px 16px; }
    .page-toolbar { display: flex; justify-content: space-between; }
    .back-link { text-decoration: none; color: inherit; }
    .loading { padding: 24px 8px; color: #777; font-size: 0.9rem; }
    .toolbar-btn {
      font-size: 0.8rem; padding: 4px 12px; border: 1px solid #ccc;
      border-radius: 4px; background: #fff; cursor: pointer;
    }
    .toolbar-btn:hover { background: #f0f0f0; }
    .account-header {
      display: flex; gap: 24px; align-items: baseline;
      padding: 8px 4px; font-size: 0.9rem; color: #444;
    }
    .account-header .as-of { margin-left: auto; font-size: 0.75rem; color: #888; }
    .diverged { color: #e65100; cursor: help; margin-left: 4px; }
    .non-agentic {
      margin-left: 8px; padding: 1px 6px; border-radius: 8px;
      background: #eceff1; color: #546e7a; font-size: 0.65rem;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .alloc-table { width: 100%; margin-top: 8px; border-collapse: collapse; }
    .alloc-table td { padding: 4px 8px; border-bottom: 1px solid #eee; }
    .error-banner {
      padding: 8px 12px; margin: 8px 0; border-radius: 4px;
      background: #fdecea; color: #b3261e; font-size: 0.85rem;
    }
  `],
})
export class AllocationPageComponent implements OnInit {
  protected readonly store = inject(AllocationStore);

  ngOnInit(): void {
    this.store.loadAccounts();
  }

  onAccountTab(index: number): void {
    this.store.selectAccount(index);
  }

  /** Refresh the selected account; when nothing is loaded (or the account
   *  list itself failed) the button retries the full account load —
   *  refresh() alone would no-op with zero accounts. */
  onRefresh(): void {
    if (this.store.accounts().length === 0 || this.store.loadError()) {
      this.store.loadAccounts();
    } else {
      this.store.refresh();
    }
  }

  readonly fmt = fmtDollars;
}
