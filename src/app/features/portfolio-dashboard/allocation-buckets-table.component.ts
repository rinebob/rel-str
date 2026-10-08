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
 *
 * Clicking a bucket (or Unassigned) name expands an inline panel —
 * stats strip + positions mini-table (task #693, replaces the modal
 * detail dialog on this page; the dialog component is retained unused
 * for possible reuse on the portfolio page).
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
  fmtDollars,
  fmtQty as fmtQtyShared,
  isUnassignedRow,
  positionPnl,
  type BucketRow,
  type PositionRow,
} from './allocation.types';
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

      <div class="table-wrap">
      <table class="alloc-table">
        <thead>
          <tr>
            <th>Bucket</th><th class="num">Target %</th><th class="num">Target $</th><th class="num">Exposure</th>
            <th class="num">Drift</th><th class="num">Realized</th><th class="num">Unrealized</th>
            <th class="num">Open/Closed</th><th>Status</th><th></th>
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
    </div>

    <ng-template #bucketRow let-row>
      <tr [attr.data-testid]="'bucket-row-' + rowKey(row)"
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
          <td><button class="name-link" type="button"
            data-testid="expand-unassigned"
            [attr.aria-expanded]="isExpanded(row)"
            (click)="toggleExpand(row)"
          >{{ isExpanded(row) ? '▾' : '▸' }} Unassigned</button></td>
          <td class="dim">—</td><td class="dim">—</td>
          <td class="num">{{ fmt(row.stats?.exposure ?? null) }}</td>
          <td class="dim">—</td>
          <td class="num">{{ fmt(row.stats?.realizedPnl ?? null) }}</td>
          <td class="num">{{ fmt(row.stats?.unrealizedPnl ?? null) }}</td>
          <td class="num">{{ row.stats?.openCount ?? 0 }}/{{ row.stats?.closedCount ?? 0 }}</td>
          <td class="dim">—</td><td></td>
        } @else if (row.bucket && row.stats) {
          <td><button class="name-link" type="button"
            [attr.data-testid]="'expand-' + row.bucket.id"
            [attr.aria-label]="'Toggle ' + row.bucket.name + ' positions'"
            [attr.aria-expanded]="isExpanded(row)"
            (click)="toggleExpand(row)"
          >{{ isExpanded(row) ? '▾' : '▸' }} {{ row.bucket.name }}</button></td>
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
      @if (isExpanded(row)) {
        <tr class="expand-row" [attr.data-testid]="'expand-panel-' + rowKey(row)">
          <td colspan="10">
            @if (row.stats) {
              <div class="expand-stats">
                @if (row.kind === 'bucket' && row.bucket) {
                  <span>Target <b>{{ row.bucket.targetPct }}% → {{ fmt(row.stats.targetDollars) }}</b></span>
                }
                <span>Exposure <b>{{ fmt(row.stats.exposure) }}</b></span>
                <span>Drift <b [class.neg]="row.stats.drift < 0">{{ fmt(row.stats.drift) }}</b></span>
                <span>Realized <b>{{ fmt(row.stats.realizedPnl) }}</b></span>
                <span>Unrealized <b>{{ fmt(row.stats.unrealizedPnl) }}</b></span>
                <span>Open/Closed <b>{{ row.stats.openCount }}/{{ row.stats.closedCount }}</b></span>
              </div>
            }
            @if (positionsFor(row).length) {
              <table class="mini-table">
                <thead>
                  <tr><th>Instrument</th><th class="num">Qty</th><th class="num">Market value</th><th class="num">Cost basis</th><th class="num">Unrealized</th></tr>
                </thead>
                <tbody>
                  @for (p of positionsFor(row); track p.position.instrumentId) {
                    <tr [attr.data-testid]="'expand-pos-' + p.position.instrumentId">
                      <td>{{ p.position.instrumentId }}</td>
                      <td class="num">{{ fmtQty(p.position.quantity) }}</td>
                      <td class="num">{{ fmt(p.position.marketValue) }}</td>
                      <td class="num">{{ fmt(p.position.costBasis) }}</td>
                      <td class="num" [class.neg]="pnlOf(p) < 0">{{ fmt(pnlOf(p)) }}</td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="totals" [attr.data-testid]="'expand-totals-' + rowKey(row)">
                    <td>Total</td>
                    <td class="num qty"></td>
                    <td class="num">{{ fmt(totalsFor(row).mv) }}</td>
                    <td class="num">{{ fmt(totalsFor(row).cost) }}</td>
                    <td class="num" [class.neg]="totalsFor(row).pnl < 0">{{ fmt(totalsFor(row).pnl) }}</td>
                  </tr>
                </tfoot>
              </table>
            } @else {
              <div class="dim empty-expand">No positions</div>
            }
          </td>
        </tr>
      }
    </ng-template>
  `,
  styles: [`
    /* Row-scroll convention (#779 QA / pd table-wrap): the pane fills the
       bounded tab body; the toolbar/warn banner stay put while the table's
       own wrap scrolls the rows under a sticky header. */
    :host { display: block; height: 100%; }
    .buckets-pane { display: flex; flex-direction: column; height: 100%; }
    .pane-toolbar { display: flex; justify-content: flex-end; margin: 8px 0 4px; flex-shrink: 0; }
    .warn-banner {
      padding: 6px 10px; margin: 4px 0; border-radius: 4px; flex-shrink: 0;
      background: #fff8e1; color: #8d6e00; font-size: 0.8rem; cursor: help;
    }
    .table-wrap { flex: 1; min-height: 0; overflow: auto; }
    /* Dense buttons — ≈⅔ height: 24px stroked (dashboard row-action
       convention) / 28px icon buttons. */
    .pane-toolbar button[mat-stroked-button] {
      --mdc-outlined-button-container-height: 24px;
      height: 24px; min-width: 0; padding: 0 8px; font-size: 0.7rem; line-height: 1; letter-spacing: 0;
    }
    .actions button[mat-icon-button] {
      --mdc-icon-button-state-layer-size: 28px;
      width: 28px; height: 28px; padding: 0;
      --mdc-icon-button-icon-size: 16px;
    }
    .alloc-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .alloc-table th {
      position: sticky; top: 0; z-index: 1;
      background: var(--mat-sys-surface);
      text-align: left; font-weight: 500; color: #777; padding: 4px 8px; border-bottom: 1px solid #ddd;
    }
    .alloc-table th.num { text-align: right; }
    .alloc-table td { padding: 4px 8px; border-bottom: 1px solid #eee; }
    .alloc-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .alloc-table .dim { color: #999; }
    .alloc-table tr[data-kind='cash'] td { background: #fafafa; font-style: italic; }
    .alloc-table tr[data-kind='unassigned'] td { color: #888; }
    .alloc-table.retired td { color: var(--mat-sys-on-surface-variant); font-style: italic; }
    .neg { color: #c62828; } .pos { color: #2e7d32; }
    .actions { white-space: nowrap; }
    .name-link {
      border: 0; background: none; padding: 0; cursor: pointer;
      font: inherit; color: inherit; text-decoration: underline;
      text-decoration-color: #bbb; text-underline-offset: 2px;
    }
    .name-link:hover { text-decoration-color: #555; }
    /* Retired-section chrome on tokens (#779); full density reskin is
       #780's dense-table pass. */
    .retired-section { margin-top: 10px; }
    .retired-toggle {
      border: 0; background: none; padding: 4px 0; cursor: pointer;
      font-size: 0.8rem; color: var(--mat-sys-on-surface-variant);
    }
    .retired-toggle:hover { color: var(--mat-sys-on-surface); }
    /* Expando reads as part of the table row, not a nested card — subtle
       container tint + a hairline outline border, both tokenized. */
    .expand-row td {
      background: var(--mat-sys-surface-container-low);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      border-left: 3px solid var(--mat-sys-outline-variant);
      padding: 8px;
    }
    .expand-stats { display: flex; flex-wrap: wrap; gap: 16px; font-size: 0.8rem; color: #666; margin-bottom: 8px; }
    .mini-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .mini-table th { text-align: left; font-weight: 500; color: #888; padding: 2px 12px 2px 0; }
    .mini-table th.num { text-align: right; padding-left: 24px; }
    .mini-table td { padding: 2px 12px 2px 0; border-top: 1px solid #f0f0f0; }
    .mini-table tfoot td { border-top: 1px solid #ddd; font-weight: 500; padding-top: 4px; }
    .mini-table td.num { text-align: right; padding-left: 24px; font-variant-numeric: tabular-nums; }
    .empty-expand { font-size: 0.8rem; padding: 8px 0; }
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

  readonly fmtQty = fmtQtyShared;

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

  /** Row ids whose inline positions panel is open (task #693 — replaces
   *  the modal detail dialog on this page). Keyed by rowKey so bucket,
   *  unassigned, and retired rows share the mechanic. Bucket ids are
   *  account-scoped so stale keys can't cross-pollinate on an account
   *  switch; 'unassigned' staying open across accounts is intentional —
   *  the panel re-derives to the new account's rows. */
  readonly expandedIds = signal<ReadonlySet<string>>(new Set());

  isExpanded(row: BucketRow): boolean {
    return this.expandedIds().has(this.rowKey(row));
  }

  toggleExpand(row: BucketRow): void {
    const key = this.rowKey(row);
    this.expandedIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  /** Expanded-panel positions grouped by rowKey in ONE pass over
   *  positionsRows — a row's list is a map lookup, not a re-filter per
   *  render. Unassigned membership uses the shared isUnassignedRow
   *  predicate (same fold the Positions tab and unassignedStats apply).
   *  Dangling rows land on 'unassigned'; a deleted bucket's id can't
   *  collide with a live rowKey. */
  protected readonly positionsByRowKey = computed(() => {
    const map = new Map<string, PositionRow[]>();
    for (const p of this.store.positionsRows()) {
      const key = isUnassignedRow(p) ? 'unassigned' : p.bucketId!;
      const list = map.get(key);
      if (list) list.push(p); else map.set(key, [p]);
    }
    return map;
  });

  /** Positions shown in a row's expanded panel — bucket rows list their
   *  attributed positions, Unassigned lists unattributed + dangling,
   *  Cash has no positions and never expands. */
  positionsFor(row: BucketRow): PositionRow[] {
    return this.positionsByRowKey().get(this.rowKey(row)) ?? [];
  }

  readonly pnlOf = positionPnl;

  /** Column totals over the expanded row's positions — qty is omitted
   *  (summing share counts across instruments is meaningless). */
  totalsFor(row: BucketRow): { mv: number; cost: number; pnl: number } {
    let mv = 0, cost = 0;
    for (const r of this.positionsFor(row)) {
      mv += r.position.marketValue;
      cost += r.position.costBasis;
    }
    return { mv, cost, pnl: mv - cost };
  }

  openDelete(row: BucketRow): void {
    const acct = this.store.selectedAccount();
    if (!acct) return;
    this.dialog.open(AllocationBucketDialogComponent, {
      data: { mode: 'delete', accountNumber: acct.accountNumber, bucket: row.bucket! } satisfies BucketDialogData,
    });
  }
}
