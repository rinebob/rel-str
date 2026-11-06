/**
 * AllocationPageComponent — the Allocation Manager page shell
 * (Blueprint #582 / task #588; visual-language migration in #779).
 *
 * Mirrors the dashboard shell (#776): the header bar carries the shared
 * account switcher, the compact account strip (data, not nav), and the
 * page actions (New bucket, back, refresh — #789: everything non-table
 * lives in the bar so the tab panes get the full column below it). A
 * single Buckets | Positions tab group sits in the centered content
 * column. The shell bounds the tab chain so tall content (expanded
 * bucket panels) scrolls the pane instead of clipping below the viewport.
 */
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DsDialogService } from '../../shared/ds/ds-dialog';



import { AllocationStore } from './allocation.store';
import { fmtDollars } from './allocation.types';
import { AppRoutes } from '../../core/common/interfaces';
import { AccountSwitcherComponent } from './components/account-switcher.component';
import {
  AllocationBucketDialogComponent,
  type BucketDialogData,
} from './allocation-bucket-dialog.component';
import { AllocationBucketsTableComponent } from './allocation-buckets-table.component';
import { AllocationPositionsTableComponent } from './allocation-positions-table.component';

@Component({
  selector: 'app-allocation-page',
  imports: [RouterLink, DatePipe,
    AccountSwitcherComponent, AllocationBucketsTableComponent, AllocationPositionsTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="alloc-root">
      @let accounts = store.accounts();

      <!-- Header bar: account switcher | account strip | new-bucket +
           back + refresh (title lives in the global rs-header — #853).
           Refresh stays rendered even with zero accounts — it doubles as
           the load-retry control. -->
      <header class="alloc-header" data-testid="page-header">
        @if (accounts.length) {
          <app-account-switcher
            class="alloc-account-switcher"
            [accounts]="accounts"
            [selectedIndex]="store.selectedAccountIndex()"
            (selectionChange)="onAccountSelect($event)"
          />
          @if (store.accountHeader(); as hdr) {
            <div class="account-header" data-testid="account-header">
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
                    tabindex="0" role="img" aria-label="Cash divergence warning — broker vs derived mismatch" title="Broker cash {{ fmt(hdr.cash) }} vs derived {{ fmt(hdr.derivedCash) }} — positions snapshot may be stale"
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
            </div>
          }
        }
        <div class="bar-actions">
          @if (accounts.length) {
            <button class="ds-btn outline" type="button" data-testid="create-bucket-btn"
 (click)="openCreate()"
 ><span class="dse-icon">add</span> New bucket</button>
          }
          <a class="ds-btn outline" [routerLink]="portfolioRoute" data-testid="back-to-portfolio">Portfolio</a>
          <button class="icon-btn" type="button" data-testid="refresh-btn"
 [disabled]="store.selectedAllocation().loading"
 (click)="onRefresh()"
 aria-label="Refresh allocations" title="Reload account data"
 ><span class="dse-icon">refresh</span></button>
        </div>
      </header>

      <div class="alloc-content">

        @if (store.loadError(); as err) {
          <div class="alloc-error" data-testid="load-error" role="alert">
            <span class="dse-icon" aria-hidden="true">error</span>
            <span class="error-text">{{ err }}</span>
          </div>
        }

        @if (!store.loadError() && accounts.length === 0 && !store.accountsLoaded()) {
          <div class="alloc-state" data-testid="accounts-loading">
            <span class="dse-icon" aria-hidden="true">account_balance</span>
            <p>Loading accounts…</p>
          </div>
        } @else if (accounts.length === 0 && store.accountsLoaded() && !store.loadError()) {
          <div class="alloc-state" data-testid="accounts-empty">
            <span class="dse-icon" aria-hidden="true">account_balance</span>
            <p>No Robinhood accounts available.</p>
          </div>
        }

        @if (accounts.length) {
          <div class="dse-tabs alloc-tabs" data-testid="subtabs">
            <div class="tab-bar" role="tablist" aria-label="Allocation sections" (keydown)="onTabKeydown($event)">
              <button type="button" class="tab" role="tab" id="alloc-tab-0"
                data-testid="subtab-buckets"
                [class.active]="subtab() === 0"
                [attr.aria-selected]="subtab() === 0"
                aria-controls="alloc-panel-0"
                (click)="subtab.set(0)">Buckets</button>
              <button type="button" class="tab" role="tab" id="alloc-tab-1"
                data-testid="subtab-positions"
                [class.active]="subtab() === 1"
                [attr.aria-selected]="subtab() === 1"
                aria-controls="alloc-panel-1"
                (click)="subtab.set(1)">Positions</button>
            </div>
            @if (subtab() === 0) {
            <div class="tab-body alloc-tab-content" role="tabpanel" id="alloc-panel-0" aria-labelledby="alloc-tab-0">
                @if (store.selectedAllocation().loading) {
                  <div class="alloc-state" data-testid="buckets-loading"><p>Loading…</p></div>
                } @else if (store.selectedError(); as err) {
                  <div class="alloc-error" data-testid="account-error" role="alert">
                    <span class="dse-icon" aria-hidden="true">error</span>
                    <span class="error-text">{{ err }}</span>
                  </div>
                } @else {
                  <app-allocation-buckets-table />
                }
            </div>
            }
            @if (subtab() === 1) {
            <div class="tab-body alloc-tab-content" role="tabpanel" id="alloc-panel-1" aria-labelledby="alloc-tab-1">
                @if (store.selectedAllocation().loading) {
                  <div class="alloc-state" data-testid="positions-loading"><p>Loading…</p></div>
                } @else if (store.selectedError(); as err) {
                  <div class="alloc-error" data-testid="account-error" role="alert">
                    <span class="dse-icon" aria-hidden="true">error</span>
                    <span class="error-text">{{ err }}</span>
                  </div>
                } @else {
                  <app-allocation-positions-table />
                }
            </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styleUrl: './allocation-page.component.scss',
})
export class AllocationPageComponent implements OnInit {
  protected readonly store = inject(AllocationStore);
  private readonly dialog = inject(DsDialogService);

  /** Same `allocationRoute` convention as the dashboard (#776). */
  readonly portfolioRoute = '/' + AppRoutes.PORTFOLIO_DASHBOARD;

  /** Active section tab: 0 Buckets, 1 Positions. */
  readonly subtab = signal(0);

  ngOnInit(): void {
    this.store.loadAccounts();
  }

  onAccountSelect(index: number): void {
    this.store.selectAccount(index);
  }

  /** WAI-ARIA tabs keyboard nav: arrows move + activate, Home/End jump. */
  onTabKeydown(event: KeyboardEvent): void {
    const tabs = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.tab'),
    );
    const count = tabs.length;
    if (count === 0) return;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight': next = (this.subtab() + 1) % count; break;
      case 'ArrowLeft':  next = (this.subtab() - 1 + count) % count; break;
      case 'Home':       next = 0; break;
      case 'End':        next = count - 1; break;
      default: return;
    }
    event.preventDefault();
    this.subtab.set(next);
    tabs[next]?.focus();
  }

  /** Create-bucket affordance lives in the page header (#789) — the
   *  same dialog the buckets table's edit/retire/delete rows use.
   *  Capture the account at open time — a create writes by accountNumber. */
  openCreate(): void {
    const acct = this.store.selectedAccount();
    if (!acct) return;
    this.dialog.open(AllocationBucketDialogComponent, {
      data: { mode: 'create', accountNumber: acct.accountNumber } satisfies BucketDialogData,
    });
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
