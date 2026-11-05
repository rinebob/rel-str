/**
 * AllocationAssignDialogComponent — the assign/move bucket picker
 * (Blueprint #582 / task #590). Lists the account's ACTIVE buckets plus
 * an Unassigned option (routes through unassignPosition — absence of a
 * doc IS the Unassigned encoding). A row carrying linkKey moves the
 * whole linked group atomically (the service fans it out) — the dialog
 * notes that so a spread move is never a surprise. Owns the write:
 * closes only on success, stays open with the error inline on failure.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DS_DIALOG_DATA } from '../../shared/ds/ds-dialog';
import { DsDialogRef } from '../../shared/ds/ds-dialog';

import { FormsModule } from '@angular/forms';

import { AllocationStore } from './allocation.store';
import type { AllocationBucket } from '@portfolio-allocation/contracts';

export interface AssignDialogData {
  mode: 'assign';
  accountNumber: string;
  /** The instruments being assigned — bulk passes several; each item's
   *  linkKey is forwarded so multi-leg groups still move atomically. */
  items: { instrumentId: string; linkKey?: string }[];
  /** Buckets offered — caller pre-filters to ACTIVE. */
  buckets: AllocationBucket[];
  /** Current attribution for single-item assigns (preselects the radio).
   *  Meaningless for bulk — mixed selection → no preselect. */
  currentBucketId?: string | null;
}

/** Picker sentinel — no real bucket id can equal it (ids are acct_slug). */
const UNASSIGNED = '__unassigned__';

@Component({
  selector: 'app-allocation-assign-dialog',
  imports: [ FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="title">{{ title() }}</h2>
    <div class="content">
      <div class="picker" role="radiogroup" aria-label="Assign to bucket">
        @for (b of data.buckets; track b.id) {
          <label class="dse-radio" [attr.data-testid]="'pick-' + b.id">
            <input type="radio" name="bucket-pick" [value]="b.id"
              [(ngModel)]="selected" />
            {{ b.name }} <span class="dim">({{ b.targetPct }}%)</span>
          </label>
        }
        <label class="dse-radio" data-testid="pick-unassigned">
          <input type="radio" name="bucket-pick" [value]="UNASSIGNED"
            [(ngModel)]="selected" />
          Unassigned
        </label>
      </div>

      @if (hasLinked()) {
        <p class="link-note" data-testid="link-note">
          Linked orders move together — every leg of a selected group follows.
        </p>
      }
      @if (error(); as err) {
        <div class="dialog-error" data-testid="dialog-error" role="alert">{{ err }}</div>
      }
    </div>
    <div class="actions" align="end">
      <button class="ds-btn outline" type="button" data-testid="dialog-cancel"
 [disabled]="pending()" (click)="ref.close(undefined)"
 >Cancel</button>
      <button class="ds-btn fill" type="button" data-testid="dialog-save"
 [disabled]="pending() || selected === current" (click)="save()"
 >
        @if (pending()) { <span class="dse-spinner" style="--spinner-size: 18px" role="progressbar" aria-label="Loading"></span> }
        {{ selected === UNASSIGNED ? 'Unassign' : (data.currentBucketId ? 'Move' : 'Assign') }}
      </button>
    </div>
  `,
  styleUrl: './allocation-assign-dialog.component.scss',
})
export class AllocationAssignDialogComponent {
  protected readonly data = inject<AssignDialogData>(DS_DIALOG_DATA);
  protected readonly ref = inject(
    DsDialogRef<AllocationAssignDialogComponent, true | undefined>,
  );
  protected readonly UNASSIGNED = UNASSIGNED;
  private readonly store = inject(AllocationStore);

  /** The pre-existing attribution — re-picking it writes nothing. Bulk
   *  selects are mixed, so they get no preselect (current = Unassigned
   *  sentinel keeps 'Unassign' disabled as the no-op choice). */
  readonly current = this.data.items.length === 1
    ? (this.data.currentBucketId ?? UNASSIGNED)
    : UNASSIGNED;
  /** ngModel-bound radio value — a bucket id or the Unassigned sentinel.
   *  Plain field on purpose: the template's [disabled] expression
   *  re-evaluates each change-detection pass. */
  selected = this.current;

  readonly pending = signal(false);
  readonly error = signal<string | null>(null);

  readonly title = computed(() =>
    this.data.items.length === 1
      ? `Assign ${this.data.items[0].instrumentId}`
      : `Assign ${this.data.items.length} positions`,
  );

  readonly hasLinked = computed(() => this.data.items.some((i) => i.linkKey));

  async save(): Promise<void> {
    if (this.pending() || this.selected === this.current) return;
    this.pending.set(true);
    this.error.set(null);
    try {
      if (this.selected === UNASSIGNED) {
        await this.store.unassignPositions(
          this.data.accountNumber, this.data.items.map((i) => i.instrumentId),
        );
      } else {
        await this.store.assignPositions(
          this.data.accountNumber, this.data.items, this.selected,
        );
      }
      this.ref.close(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      this.pending.set(false);
    }
  }
}
