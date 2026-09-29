/**
 * AllocationPositionsTableComponent — the Positions subtab
 * (Blueprint #582 / task #590). Every open position with its bucket
 * (or Unassigned), an All/Unassigned filter, and a per-row assign
 * action opening the shared picker — post-hoc attribution AND moves
 * go through the same dialog. Works identically on non-agentic
 * accounts (manual-only path). Rows carrying linkKey move as a group.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AllocationStore } from './allocation.store';
import {
  AllocationAssignDialogComponent,
  type AssignDialogData,
} from './allocation-assign-dialog.component';
import type { PositionRow } from './allocation.types';
import { BucketStatus } from '@portfolio-allocation/contracts';

@Component({
  selector: 'app-allocation-positions-table',
  imports: [MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatIconModule, MatMenuModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="positions-pane">
      <div class="pane-toolbar">
        <mat-button-toggle-group class="filter" [value]="filter()" aria-label="Position filter">
          <mat-button-toggle value="all" data-testid="filter-all"
            (click)="filter.set('all')"
          >All</mat-button-toggle>
          <mat-button-toggle value="unassigned" data-testid="filter-unassigned"
            (click)="filter.set('unassigned')"
          >Unassigned ({{ unassignedCount() }})</mat-button-toggle>
        </mat-button-toggle-group>

        @if (selection().size > 0) {
          <span class="selection-bar" data-testid="selection-bar">
            {{ selection().size }} selected
            <button mat-stroked-button type="button" data-testid="bulk-actions"
              [disabled]="bulkPending()" [matMenuTriggerFor]="bulkMenu"
            >Actions</button>
          </span>
        }
      </div>

      <mat-menu #bulkMenu="matMenu">
        <button mat-menu-item type="button" data-testid="bulk-assign"
          (click)="openBulkAssign()"
        >Assign to bucket…</button>
        <button mat-menu-item type="button" data-testid="bulk-unassign"
          (click)="bulkUnassign()"
        >Unassign</button>
      </mat-menu>

      @if (bulkError(); as err) {
        <div class="bulk-error" data-testid="bulk-error" role="alert">{{ err }}</div>
      }

      <table class="alloc-table">
        <thead>
          <tr>
            <th class="chk">
              <mat-checkbox data-testid="select-all"
                [checked]="allSelected()" [indeterminate]="someSelected()"
                (change)="toggleAll($event.checked)" aria-label="Select all"
              />
            </th>
            <th>Instrument</th><th>Market value</th><th>Bucket</th><th></th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.position.instrumentId) {
            <tr [attr.data-testid]="'position-row-' + row.position.instrumentId">
              <td class="chk">
                <mat-checkbox [attr.data-testid]="'select-' + row.position.instrumentId"
                  [checked]="selection().has(row.position.instrumentId)"
                  (change)="toggle(row.position.instrumentId, $event.checked)"
                  [attr.aria-label]="'Select ' + row.position.instrumentId"
                />
              </td>
              <td>{{ row.position.instrumentId }}</td>
              <td class="num">{{ fmt(row.position.marketValue) }}</td>
              <td [class.dim]="row.bucketId === null">
                {{ row.bucketName }}
                @if (row.linkKey) {
                  <mat-icon class="link-icon" data-testid="link-icon"
                    matTooltip="Linked multi-leg order — moves as a group"
                  >link</mat-icon>
                }
              </td>
              <td class="actions">
                <button mat-stroked-button type="button"
                  [attr.data-testid]="'assign-' + row.position.instrumentId"
                  (click)="openAssign(row)"
                >{{ row.bucketId === null ? 'Assign' : 'Move' }}</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="dim">
              {{ filter() === 'unassigned' ? 'No unassigned positions' : 'No positions' }}
            </td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .pane-toolbar { display: flex; align-items: center; justify-content: space-between; margin: 8px 0 4px; }
    .selection-bar { display: inline-flex; align-items: center; gap: 10px; font-size: 0.85rem; color: #555; }
    .bulk-error {
      padding: 6px 10px; margin: 4px 0; border-radius: 4px;
      background: #fdecea; color: #b3261e; font-size: 0.8rem;
    }
    .alloc-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .alloc-table th { text-align: left; font-weight: 500; color: #777; padding: 4px 8px; border-bottom: 1px solid #ddd; }
    .alloc-table td { padding: 4px 8px; border-bottom: 1px solid #eee; }
    .alloc-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .alloc-table .chk { width: 40px; }
    .dim { color: #999; }
    .actions { text-align: right; }
    .link-icon { font-size: 14px; width: 14px; height: 14px; vertical-align: middle; color: #777; }
  `],
})
export class AllocationPositionsTableComponent {
  protected readonly store = inject(AllocationStore);
  private readonly dialog = inject(MatDialog);

  readonly filter = signal<'all' | 'unassigned'>('all');

  /** Unassigned = no attribution, OR a dangling one (bucket deleted
   *  out-of-band) — same predicate the header's unassignedExposure and
   *  the Unassigned pseudo-row use, so the filter can't hide rows the
   *  header counts. Dangling rows still render 'Unknown bucket' in the
   *  All view to surface the data issue. */
  protected isUnassigned(row: PositionRow): boolean {
    return row.bucketId === null || row.unresolved === true;
  }

  readonly unassignedCount = computed(() =>
    this.store.positionsRows().filter((r) => this.isUnassigned(r)).length,
  );

  readonly rows = computed(() => {
    const all = this.store.positionsRows();
    return this.filter() === 'unassigned'
      ? all.filter((r) => this.isUnassigned(r))
      : all;
  });

  fmt(v: number | null | undefined): string {
    return v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  // -- bulk selection --

  /** Checked instrumentIds — survives filter toggles (keyed, not index). */
  readonly selection = signal(new Set<string>());
  readonly bulkPending = signal(false);
  readonly bulkError = signal<string | null>(null);

  readonly allSelected = computed(() => {
    const rows = this.rows();
    return rows.length > 0 && rows.every((r) => this.selection().has(r.position.instrumentId));
  });
  readonly someSelected = computed(() => this.selection().size > 0 && !this.allSelected());

  toggle(instrumentId: string, checked: boolean): void {
    this.selection.update((s) => {
      const next = new Set(s);
      if (checked) next.add(instrumentId); else next.delete(instrumentId);
      return next;
    });
  }

  /** Select-all applies to the current filtered view only. */
  toggleAll(checked: boolean): void {
    this.selection.update((s) => {
      const next = new Set(s);
      for (const r of this.rows()) {
        if (checked) next.add(r.position.instrumentId); else next.delete(r.position.instrumentId);
      }
      return next;
    });
  }

  private selectedRows(): PositionRow[] {
    return this.store.positionsRows().filter((r) => this.selection().has(r.position.instrumentId));
  }

  private activeBuckets() {
    return (this.store.selectedAllocation()?.buckets ?? [])
      .filter((b) => b.status === BucketStatus.ACTIVE);
  }

  openAssign(row: PositionRow): void {
    const acct = this.store.selectedAccount();
    if (!acct) return;
    this.dialog.open(AllocationAssignDialogComponent, {
      data: {
        mode: 'assign',
        accountNumber: acct.accountNumber,
        items: [{ instrumentId: row.position.instrumentId, linkKey: row.linkKey }],
        buckets: this.activeBuckets(),
        currentBucketId: row.bucketId,
      } satisfies AssignDialogData,
    });
  }

  openBulkAssign(): void {
    const acct = this.store.selectedAccount();
    const items = this.selectedRows()
      .map((r) => ({ instrumentId: r.position.instrumentId, linkKey: r.linkKey }));
    if (!acct || !items.length) return;
    // Bulk mix has no single current bucket — no preselect.
    this.dialog.open(AllocationAssignDialogComponent, {
      data: { mode: 'assign', accountNumber: acct.accountNumber, items, buckets: this.activeBuckets() } satisfies AssignDialogData,
    }).afterClosed().subscribe((done) => {
      if (done) this.selection.set(new Set());
    });
  }

  async bulkUnassign(): Promise<void> {
    const acct = this.store.selectedAccount();
    const ids = this.selectedRows().map((r) => r.position.instrumentId);
    if (!acct || !ids.length || this.bulkPending()) return;
    this.bulkPending.set(true);
    this.bulkError.set(null);
    try {
      await this.store.unassignPositions(acct.accountNumber, ids);
      this.selection.set(new Set());
    } catch (err) {
      this.bulkError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.bulkPending.set(false);
    }
  }
}
