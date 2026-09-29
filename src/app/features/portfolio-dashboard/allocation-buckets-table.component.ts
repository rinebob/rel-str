/**
 * AllocationBucketsTableComponent — the unified Buckets subtab
 * (Blueprint #582 / task #589). One table merging bucket config with
 * computeBucketStats analytics: name, target %/$, exposure, drift,
 * realized+unrealized P&L, open/closed counts, status. Cash row pinned
 * last (computed, non-editable); Unassigned pseudo-row is read-only.
 * Row actions (edit → rename+retarget, retire → confirm) and the create
 * affordance open the shared bucket dialog, which owns the write and
 * only closes on success. RETIRED buckets move to a collapsed section
 * below the table — hidden by default, stats preserved. Σ active
 * targets > 100% warns — never blocks.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AllocationStore } from './allocation.store';
import {
  AllocationBucketDialogComponent,
  type BucketDialogData,
} from './allocation-bucket-dialog.component';
import {
  AllocationBucketDetailDialogComponent,
  type BucketDetailDialogData,
} from './allocation-bucket-detail-dialog.component';
import { fmtDollars, type BucketRow } from './allocation.types';
import { BucketStatus } from '@portfolio-allocation/contracts';

@Component({
  selector: 'app-allocation-buckets-table',
  // NB: no MatDialogModule here — its providers:[MatDialog] would shadow
  // test mocks; the dialog component itself imports what it needs.
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="buckets-pane">
      <div class="pane-toolbar">
        <button mat-stroked-button type="button" data-testid="create-bucket-btn"
          (click)="openCreate()"
        ><mat-icon>add</mat-icon> New bucket</button>
      </div>

      @if (overTarget(); as total) {
        <div class="warn-banner" data-testid="target-over-100" tabindex="0"
          role="note" aria-label="Bucket targets exceed 100 percent of account cash"
          matTooltip="Targets are advisory — assignments never block"
        >Targets sum to {{ total }}% of account cash — over 100%.</div>
      }

      <table class="alloc-table">
        <thead>
          <tr>
            <th>Bucket</th><th>Target %</th><th>Target $</th><th>Exposure</th>
            <th>Drift</th><th>Realized</th><th>Unrealized</th>
            <th>Open/Closed</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          @for (row of activeRows(); track rowKey(row)) {
            <ng-container *ngTemplateOutlet="bucketRow; context: { $implicit: row }" />
          }
        </tbody>
      </table>

      @if (retiredRows().length) {
        <div class="retired-section">
          <button class="retired-toggle" type="button" data-testid="retired-toggle"
            [attr.aria-expanded]="showRetired()"
            (click)="showRetired.set(!showRetired())"
          >
            {{ showRetired() ? '▾' : '▸' }} Retired ({{ retiredRows().length }})
          </button>
          @if (showRetired()) {
            <table class="alloc-table retired">
              <tbody>
                @for (row of retiredRows(); track rowKey(row)) {
                  <ng-container *ngTemplateOutlet="bucketRow; context: { $implicit: row }" />
                }
              </tbody>
            </table>
          }
        </div>
      }
    </div>

    <ng-template #bucketRow let-row>
      <tr [attr.data-testid]="'bucket-row-' + (row.bucket?.id ?? row.kind)"
        [attr.data-kind]="row.kind">
        @if (row.kind === 'cash') {
          <td colspan="3">Cash</td>
          <td class="num">{{ fmt(row.cash?.actual ?? null) }}</td>
          <td colspan="5" class="dim">
            @if (row.cash?.diverged) {
              broker vs derived diverge — {{ fmt(row.cash?.derived ?? null) }}
            } @else { remainder }
          </td>
          <td></td>
        } @else if (row.kind === 'unassigned') {
          <td>Unassigned</td>
          <td class="dim">—</td><td class="dim">—</td>
          <td class="num">{{ fmt(row.stats?.exposure ?? null) }}</td>
          <td class="dim">—</td>
          <td class="num">{{ fmt(row.stats?.realizedPnl ?? null) }}</td>
          <td class="num">{{ fmt(row.stats?.unrealizedPnl ?? null) }}</td>
          <td class="num">{{ row.stats?.openCount ?? 0 }}/{{ row.stats?.closedCount ?? 0 }}</td>
          <td class="dim">—</td><td></td>
        } @else if (row.bucket && row.stats) {
          <td><button class="name-link" type="button"
            [attr.data-testid]="'detail-' + row.bucket.id"
            [attr.aria-label]="'Open ' + row.bucket.name + ' detail'"
            (click)="openDetail(row)"
          >{{ row.bucket.name }}</button></td>
          <td class="num">{{ row.bucket.targetPct }}%</td>
          <td class="num">{{ fmt(row.stats.targetDollars) }}</td>
          <td class="num">{{ fmt(row.stats.exposure) }}</td>
          <td class="num" [class.neg]="row.stats.drift < 0" [class.pos]="row.stats.drift > 0">
            {{ fmt(row.stats.drift) }}
          </td>
          <td class="num" [class.neg]="row.stats.realizedPnl < 0">{{ fmt(row.stats.realizedPnl) }}</td>
          <td class="num" [class.neg]="row.stats.unrealizedPnl < 0">{{ fmt(row.stats.unrealizedPnl) }}</td>
          <td class="num">{{ row.stats.openCount }}/{{ row.stats.closedCount }}</td>
          <td>{{ row.bucket.status }}</td>
          <td class="actions">
            @if (row.bucket.status === BucketStatus.ACTIVE) {
              <button mat-icon-button type="button" [attr.data-testid]="'edit-' + row.bucket.id"
                matTooltip="Edit name / target" aria-label="Edit bucket"
                (click)="openEdit(row)">
                <mat-icon>edit</mat-icon>
              </button>
              <button mat-icon-button type="button" [attr.data-testid]="'retire-' + row.bucket.id"
                matTooltip="Retire — keeps history, blocks new attributions"
                aria-label="Retire bucket"
                (click)="openRetire(row)">
                <mat-icon>archive</mat-icon>
              </button>
            }
            <button mat-icon-button type="button" [attr.data-testid]="'delete-' + row.bucket.id"
              matTooltip="Delete — contents return to Unassigned"
              aria-label="Delete bucket"
              (click)="openDelete(row)">
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        } @else {
          <td>{{ row.bucket?.name ?? '?' }}</td>
          <td colspan="8" class="dim">stats unavailable</td>
          <td></td>
        }
      </tr>
    </ng-template>
  `,
  styles: [`
    .pane-toolbar { display: flex; justify-content: flex-end; margin: 8px 0 4px; }
    .warn-banner {
      padding: 6px 10px; margin: 4px 0; border-radius: 4px;
      background: #fff8e1; color: #8d6e00; font-size: 0.8rem; cursor: help;
    }
    .alloc-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .alloc-table th { text-align: left; font-weight: 500; color: #777; padding: 4px 8px; border-bottom: 1px solid #ddd; }
    .alloc-table td { padding: 4px 8px; border-bottom: 1px solid #eee; }
    .alloc-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .alloc-table .dim { color: #999; }
    .alloc-table tr[data-kind='cash'] td { background: #fafafa; font-style: italic; }
    .alloc-table tr[data-kind='unassigned'] td { color: #888; }
    .alloc-table.retired td { color: #999; font-style: italic; }
    .neg { color: #c62828; } .pos { color: #2e7d32; }
    .actions { white-space: nowrap; }
    .name-link {
      border: 0; background: none; padding: 0; cursor: pointer;
      font: inherit; color: inherit; text-decoration: underline;
      text-decoration-color: #bbb; text-underline-offset: 2px;
    }
    .name-link:hover { text-decoration-color: #555; }
    .retired-section { margin-top: 10px; }
    .retired-toggle {
      border: 0; background: none; padding: 4px 0; cursor: pointer;
      font-size: 0.8rem; color: #777;
    }
    .retired-toggle:hover { color: #444; }
  `],
})
export class AllocationBucketsTableComponent {
  protected readonly store = inject(AllocationStore);
  protected readonly BucketStatus = BucketStatus;
  private readonly dialog = inject(MatDialog);

  /** Retired buckets hidden by default — toggle in the section header. */
  readonly showRetired = signal(false);

  /** Main table: active buckets, Unassigned, Cash pinned last. */
  readonly activeRows = computed(() =>
    this.store.bucketRows().filter(
      (r) => r.kind !== 'bucket' || r.bucket!.status === BucketStatus.ACTIVE,
    ),
  );

  /** Retired rows — moved to the collapsed section, stats preserved. */
  readonly retiredRows = computed(() =>
    this.store.bucketRows().filter(
      (r) => r.kind === 'bucket' && r.bucket!.status === BucketStatus.RETIRED,
    ),
  );

  /** Sum of ACTIVE bucket targets — warn-only when over 100%. Non-finite
   *  stored pcts are dropped so one corrupt doc can't poison the total. */
  readonly overTarget = computed<number | null>(() => {
    const total = this.activeRows()
      .filter((r) => r.kind === 'bucket')
      .reduce((s, r) => s + (Number.isFinite(r.bucket!.targetPct) ? r.bucket!.targetPct : 0), 0);
    return total > 100 ? Math.round(total * 10) / 10 : null;
  });

  rowKey(row: BucketRow): string {
    return row.bucket?.id ?? row.kind;
  }

  readonly fmt = fmtDollars;

  openCreate(): void {
    // Capture the account at open time — a create writes by accountNumber.
    const acct = this.store.selectedAccount();
    if (!acct) return;
    this.dialog.open(AllocationBucketDialogComponent, {
      data: { mode: 'create', accountNumber: acct.accountNumber } satisfies BucketDialogData,
    });
  }

  openEdit(row: BucketRow): void {
    const acct = this.store.selectedAccount();
    if (!acct) return;
    this.dialog.open(AllocationBucketDialogComponent, {
      data: { mode: 'edit', accountNumber: acct.accountNumber, bucket: row.bucket! } satisfies BucketDialogData,
    });
  }

  openRetire(row: BucketRow): void {
    const acct = this.store.selectedAccount();
    if (!acct) return;
    this.dialog.open(AllocationBucketDialogComponent, {
      data: { mode: 'retire', accountNumber: acct.accountNumber, bucket: row.bucket! } satisfies BucketDialogData,
    });
  }

  /** Bucket detail — carousel + stats + chart stub (task #591). Works for
   *  retired rows too: their stats are still meaningful. */
  openDetail(row: BucketRow): void {
    const acct = this.store.selectedAccount();
    if (!row.bucket || !acct) return;
    this.dialog.open(AllocationBucketDetailDialogComponent, {
      data: { accountNumber: acct.accountNumber, bucketId: row.bucket.id } satisfies BucketDetailDialogData,
      width: '560px', maxWidth: '95vw',
    });
  }

  openDelete(row: BucketRow): void {
    const acct = this.store.selectedAccount();
    if (!acct) return;
    this.dialog.open(AllocationBucketDialogComponent, {
      data: { mode: 'delete', accountNumber: acct.accountNumber, bucket: row.bucket! } satisfies BucketDialogData,
    });
  }
}
