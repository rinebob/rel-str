/**
 * AllocationPageComponent — the Allocation Manager page shell
 * (Blueprint #582 / task #588; visual-language migration in #779).
 *
 * Mirrors the dashboard shell (#776): header bar carrying the shared
 * account switcher + page actions, a compact account strip (data, not
 * nav) below it, then a single Buckets | Positions tab group in the
 * centered content column. The shell bounds the tab chain so tall
 * content (expanded bucket panels) scrolls the pane instead of
 * clipping below the viewport.
 */
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AllocationStore } from './allocation.store';
import { fmtDollars } from './allocation.types';
import { AppRoutes } from '../../core/common/interfaces';
import { AccountSwitcherComponent } from './components/account-switcher.component';
import { AllocationBucketsTableComponent } from './allocation-buckets-table.component';
import { AllocationPositionsTableComponent } from './allocation-positions-table.component';

@Component({
  selector: 'app-allocation-page',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatTabsModule, MatTooltipModule, DatePipe,
    AccountSwitcherComponent, AllocationBucketsTableComponent, AllocationPositionsTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="alloc-root">
      @let accounts = store.accounts();

      <!-- Header bar: account switcher | back + refresh (title lives in
           the global rs-header — #853). Refresh stays rendered even with
           zero accounts — it doubles as the load-retry control. -->
      <header class="alloc-header" data-testid="page-header">
        @if (accounts.length) {
          <app-account-switcher
            class="alloc-account-switcher"
            [accounts]="accounts"
            [selectedIndex]="store.selectedAccountIndex()"
            (selectionChange)="onAccountSelect($event)"
          />
        }
        <div class="bar-actions">
          <a mat-stroked-button [routerLink]="portfolioRoute" data-testid="back-to-portfolio">Portfolio</a>
          <button mat-icon-button type="button" data-testid="refresh-btn"
            [disabled]="store.selectedAllocation().loading"
            (click)="onRefresh()"
            aria-label="Refresh allocations"
            matTooltip="Reload account data"
          ><mat-icon>refresh</mat-icon></button>
        </div>
      </header>

      <div class="alloc-content">

        @if (store.loadError(); as err) {
          <div class="alloc-error" data-testid="load-error" role="alert">
            <mat-icon aria-hidden="true">error</mat-icon>
            <span class="error-text">{{ err }}</span>
          </div>
        }

        @if (!store.loadError() && accounts.length === 0 && !store.accountsLoaded()) {
          <div class="alloc-state" data-testid="accounts-loading">
            <mat-icon aria-hidden="true">account_balance</mat-icon>
            <p>Loading accounts…</p>
          </div>
        } @else if (accounts.length === 0 && store.accountsLoaded() && !store.loadError()) {
          <div class="alloc-state" data-testid="accounts-empty">
            <mat-icon aria-hidden="true">account_balance</mat-icon>
            <p>No Robinhood accounts available.</p>
          </div>
        }

        @if (accounts.length) {
          @if (store.accountHeader(); as hdr) {
            <header class="account-header" data-testid="account-header">
              <span class="sb-item">
                <span class="sb-label">Value</span>
                <span class="sb-value">{{ fmt(hdr.accountValue) }}</span>
              </span>
              <span class="sb-sep">|</span>
              <span class="sb-item">
                <span class="sb-label">Allocated</span>
                <span class="sb-value">{{ fmt(hdr.allocated) }}</span>
              </span>
              <span class="sb-sep">|</span>
              <span class="sb-item">
                <span class="sb-label">Cash</span>
                <span class="sb-value">{{ fmt(hdr.cash) }}</span>
                @if (hdr.cashDiverged) {
                  <span class="diverged" data-testid="cash-diverged"
                    tabindex="0" role="img" aria-label="Cash divergence warning — broker vs derived mismatch"
                    matTooltip="Broker cash {{ fmt(hdr.cash) }} vs derived {{ fmt(hdr.derivedCash) }} — positions snapshot may be stale"
                  >⚠</span>
                }
              </span>
              <span class="sb-sep">|</span>
              <span class="sb-item">
                <span class="sb-label">Unassigned</span>
                <span class="sb-value">{{ fmt(hdr.unassignedExposure) }}</span>
              </span>
              @if (hdr.asOf) {
                <span class="as-of" data-testid="as-of">as of {{ hdr.asOf | date:'short' }}</span>
              }
            </header>
          }

          <mat-tab-group data-testid="subtabs" class="alloc-tabs" animationDuration="0ms">
            <mat-tab>
              <ng-template mat-tab-label><span data-testid="subtab-buckets">Buckets</span></ng-template>
              <div class="alloc-tab-content">
                @if (store.selectedAllocation().loading) {
                  <div class="alloc-state" data-testid="buckets-loading"><p>Loading…</p></div>
                } @else if (store.selectedAllocation().error; as err) {
                  <div class="alloc-error" data-testid="account-error" role="alert">
                    <mat-icon aria-hidden="true">error</mat-icon>
                    <span class="error-text">{{ err }}</span>
                  </div>
                } @else {
                  <app-allocation-buckets-table />
                }
              </div>
            </mat-tab>
            <mat-tab>
              <ng-template mat-tab-label><span data-testid="subtab-positions">Positions</span></ng-template>
              <div class="alloc-tab-content">
                @if (store.selectedAllocation().loading) {
                  <div class="alloc-state" data-testid="positions-loading"><p>Loading…</p></div>
                } @else if (store.selectedAllocation().error; as err) {
                  <div class="alloc-error" data-testid="account-error" role="alert">
                    <mat-icon aria-hidden="true">error</mat-icon>
                    <span class="error-text">{{ err }}</span>
                  </div>
                } @else {
                  <app-allocation-positions-table />
                }
              </div>
            </mat-tab>
          </mat-tab-group>
        }
      </div>
    </div>
  `,
  styleUrl: './allocation-page.component.scss',
})
export class AllocationPageComponent implements OnInit {
  protected readonly store = inject(AllocationStore);

  /** Same `allocationRoute` convention as the dashboard (#776). */
  readonly portfolioRoute = '/' + AppRoutes.PORTFOLIO_DASHBOARD;

  ngOnInit(): void {
    this.store.loadAccounts();
  }

  onAccountSelect(index: number): void {
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
