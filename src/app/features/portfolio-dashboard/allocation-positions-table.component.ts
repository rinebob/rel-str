/**
 * AllocationPositionsTableComponent — the Positions subtab
 * (Blueprint #582 / task #590). Every open position with its bucket
 * (or Unassigned), an All/Unassigned filter, and a per-row assign
 * action opening the shared picker — post-hoc attribution AND moves
 * go through the same dialog. Works identically on non-agentic
 * accounts (manual-only path). Rows carrying linkKey move as a group.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';


import { DsDialogService } from '../../shared/ds/ds-dialog';

import { AllocationStore } from './allocation.store';
import {
  AllocationAssignDialogComponent,
  type AssignDialogData,
} from './allocation-assign-dialog.component';
import { fmtDollars, isUnassignedRow, type PositionRow } from './allocation.types';
import { BucketStatus } from '@portfolio-allocation/contracts';

@Component({
  selector: 'app-allocation-positions-table',
  imports: [],
  host: { '(document:click)': 'bulkMenuOpen.set(false)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="positions-pane">
      <div class="pane-toolbar">
        <div class="pill-group filter" role="radiogroup" aria-label="Position filter">
          <button type="button" class="pill" role="radio" data-testid="filter-all"
            [attr.aria-checked]="filter() === 'all'"
            [class.active]="filter() === 'all'"
            (click)="filter.set('all')"
          >All</button>
          <button type="button" class="pill" role="radio" data-testid="filter-unassigned"
            [attr.aria-checked]="filter() === 'unassigned'"
            [class.active]="filter() === 'unassigned'"
            (click)="filter.set('unassigned')"
          >Unassigned ({{ unassignedCount() }})</button>
        </div>

        @if (selection().size > 0) {
          <span class="selection-bar" data-testid="selection-bar">
            {{ selection().size }} selected
            <span class="ms-menu-host">
            <button class="ds-btn outline" type="button" data-testid="bulk-actions"
 [disabled]="bulkPending()" aria-haspopup="menu" [attr.aria-expanded]="bulkMenuOpen()"
 (click)="toggleBulkMenu($event)"
 >Actions</button>
            @if (bulkMenuOpen()) {
            <div class="dse-menu bulk-menu" role="menu" (click)="$event.stopPropagation()">
              <button class="menu-item" role="menuitem" type="button" data-testid="bulk-assign"
                (click)="bulkMenuOpen.set(false); openBulkAssign()"
              >Assign to bucket…</button>
              <button class="menu-item" role="menuitem" type="button" data-testid="bulk-unassign"
                (click)="bulkMenuOpen.set(false); bulkUnassign()"
              >Unassign</button>
            </div>
            }
            </span>
          </span>
        }
      </div>

      @if (bulkError(); as err) {
        <div class="bulk-error" data-testid="bulk-error" role="alert">{{ err }}</div>
      }

      <div class="table-wrap">
      <table class="alloc-table">
        <thead>
          <tr>
            <th class="chk">
              <label class="dse-check"><input type="checkbox" data-testid="select-all"
                [checked]="allSelected()" [indeterminate]="someSelected()"
                (change)="toggleAll($event.target.checked)" aria-label="Select all"
              ></label>
            </th>
            <th>Instrument</th><th class="num">Market value</th><th>Bucket</th><th></th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.position.instrumentId) {
            <tr [attr.data-testid]="'position-row-' + row.position.instrumentId">
              <td class="chk">
                <label class="dse-check"><input type="checkbox" [attr.data-testid]="'select-' + row.position.instrumentId"
                  [checked]="selection().has(row.position.instrumentId)"
                  (change)="toggle(row.position.instrumentId, $event.target.checked)"
                  [attr.aria-label]="'Select ' + row.position.instrumentId"
                ></label>
              </td>
              <td>{{ row.position.instrumentId }}</td>
              <td class="num">{{ fmt(row.position.marketValue) }}</td>
              <td [class.dim]="row.bucketId === null">
                {{ row.bucketName }}
                @if (row.linkKey) {
                  <span class="dse-icon link-icon" data-testid="link-icon" title="Linked multi-leg order — moves as a group"
                  >link</span>
                }
              </td>
              <td class="actions">
                <button class="ds-btn outline" type="button"
 [attr.data-testid]="'assign-' + row.position.instrumentId"
 (click)="openAssign(row)"
 >{{ row.bucketId === null ? 'Assign' : 'Move' }}</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="dim empty-row">
              {{ filter() === 'unassigned' ? 'No unassigned positions' : 'No positions' }}
            </td></tr>
          }
        </tbody>
      </table>
      </div>
    </div>
  `,
  styleUrl: './allocation-positions-table.component.scss',
})
export class AllocationPositionsTableComponent {
  protected readonly store = inject(AllocationStore);
  private readonly dialog = inject(DsDialogService);

  readonly filter = signal<'all' | 'unassigned'>('all');

  /** Unassigned = no attribution, OR a dangling one (bucket deleted
   *  out-of-band) — shared isUnassignedRow predicate, so the filter
   *  can't hide rows the header/pseudo-row count. Dangling rows still
   *  render 'Unknown bucket' in the All view to surface the data issue. */
  readonly unassignedCount = computed(() =>
    this.store.positionsRows().filter(isUnassignedRow).length,
  );

  readonly rows = computed(() => {
    const all = this.store.positionsRows();
    return this.filter() === 'unassigned'
      ? all.filter(isUnassignedRow)
      : all;
  });

  readonly fmt = fmtDollars;

  // -- bulk selection --

  /** Checked instrumentIds — survives filter toggles (keyed, not index). */
  readonly selection = signal(new Set<string>());
  readonly bulkPending = signal(false);
  readonly bulkError = signal<string | null>(null);

  /** ds-menu dropdown — bulk actions panel open state. */
  readonly bulkMenuOpen = signal(false);

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

  /** ds-menu trigger — toggle the bulk actions panel. */
  toggleBulkMenu(event: Event): void {
    event.stopPropagation();
    this.bulkMenuOpen.update((v) => !v);
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
