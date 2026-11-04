/**
 * AllocationBucketDialogComponent — the bucket create/edit/retire dialog
 * (Blueprint #582 / task #589). One component, mode-driven:
 * - create: name + target % fields
 * - edit:   same fields prefilled (covers rename + retarget)
 * - retire: confirm copy — retired buckets keep history but reject new
 *   attributions (enforced in the bucket service + assign paths)
 *
 * The dialog owns the write: Save runs the store call and only closes on
 * success — a failure stays open with the error inline (never a silent
 * dead-end). The caller gets `true` on success, `undefined` on cancel.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DS_DIALOG_DATA } from '../../shared/ds/ds-dialog';
import { DsDialogRef } from '../../shared/ds/ds-dialog';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AllocationStore } from './allocation.store';
import type { AllocationBucket } from '@portfolio-allocation/contracts';

export interface BucketDialogData {
  mode: 'create' | 'edit' | 'retire' | 'delete';
  /** Account the write targets — captured by the caller at open time. */
  accountNumber: string;
  bucket?: AllocationBucket;
}

export interface BucketDialogResult {
  name: string;
  targetPct: number;
}

@Component({
  selector: 'app-allocation-bucket-dialog',
  imports: [ MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="title">{{ title() }}</h2>
    <div class="content">
      @if (data.mode === 'retire') {
        <p>
          Retire bucket <b>{{ data.bucket?.name }}</b>? Retired buckets keep
          their history but reject new attributions — existing positions stay
          attributed until you unassign them.
        </p>
      } @else if (data.mode === 'delete') {
        <p>
          Delete bucket <b>{{ data.bucket?.name }}</b>? Its positions and
          fills return to <b>Unassigned</b>. Unlike retire, nothing of the
          bucket remains — no history row, no stats.
        </p>
      } @else {
        <label class="dse-field">
          <span class="field-label">Bucket name</span>
          <input class="field-input" data-testid="bucket-name-input"
            [value]="name()" (input)="name.set($any($event.target).value)"
            placeholder="e.g. Theta wheel"
          />
        </label>
        <label class="dse-field">
          <span class="field-label">Target %</span>
          <input class="field-input" type="number" min="0" max="100" step="0.5"
            data-testid="bucket-pct-input"
            [value]="pct()" (input)="pct.set($any($event.target).valueAsNumber)"
          />
          <span class="field-hint">Percent of account cash basis — warn-not-block over 100% total</span>
        </label>
      }
      @if (error(); as err) {
        <div class="dialog-error" data-testid="dialog-error" role="alert">{{ err }}</div>
      }
    </div>
    <div class="actions" align="end">
      <button class="ds-btn outline" type="button" data-testid="dialog-cancel"
 [disabled]="pending()" (click)="ref.close(undefined)"
 >Cancel</button>
      @if (data.mode === 'retire' || data.mode === 'delete') {
        <button class="ds-btn danger" type="button" data-testid="dialog-confirm"
 [disabled]="pending()"
 (click)="data.mode === 'retire' ? confirmRetire() : confirmDelete()"
 >
          @if (pending()) { <mat-spinner diameter="18" /> }
          {{ data.mode === 'retire' ? 'Retire' : 'Delete' }}
        </button>
      } @else {
        <button class="ds-btn fill" type="button" data-testid="dialog-save"
 [disabled]="!valid() || pending()"
 (click)="save()"
 >
          @if (pending()) { <mat-spinner diameter="18" /> }
          {{ data.mode === 'create' ? 'Create' : 'Save' }}
        </button>
      }
    </div>
  `,
  styleUrl: './allocation-bucket-dialog.component.scss',
})
export class AllocationBucketDialogComponent {
  protected readonly data = inject<BucketDialogData>(DS_DIALOG_DATA);
  protected readonly ref = inject(
    DsDialogRef<AllocationBucketDialogComponent, true | undefined>,
  );
  private readonly store = inject(AllocationStore);

  readonly name = signal(this.data.bucket?.name ?? '');
  readonly pct = signal<number | null>(this.data.bucket?.targetPct ?? null);
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);

  readonly title = computed(() =>
    this.data.mode === 'create' ? 'New allocation bucket'
    : this.data.mode === 'edit' ? `Edit ${this.data.bucket?.name ?? 'bucket'}`
    : this.data.mode === 'delete' ? 'Delete bucket'
    : 'Retire bucket',
  );

  readonly valid = computed(() => {
    const p = this.pct();
    return this.name().trim().length > 0
      && p !== null && Number.isFinite(p) && p >= 0 && p <= 100;
  });

  async save(): Promise<void> {
    if (!this.valid() || this.pending()) return;
    const newName = this.name().trim();
    const newPct = this.pct()!;
    const bucket = this.data.bucket;
    await this.write(async () => {
      if (this.data.mode === 'create') {
        await this.store.createBucket(this.data.accountNumber, newName, newPct);
        return;
      }
      // edit — only write what changed
      if (newName !== bucket?.name) {
        await this.store.renameBucket(this.data.accountNumber, bucket!.id, newName);
      }
      if (newPct !== bucket?.targetPct) {
        await this.store.updateTargetPct(this.data.accountNumber, bucket!.id, newPct);
      }
    });
  }

  async confirmRetire(): Promise<void> {
    if (this.pending()) return;
    await this.write(() => this.store.retireBucket(this.data.accountNumber, this.data.bucket!.id));
  }

  async confirmDelete(): Promise<void> {
    if (this.pending()) return;
    await this.write(() => this.store.deleteBucket(this.data.accountNumber, this.data.bucket!.id));
  }

  private async write(fn: () => Promise<void>): Promise<void> {
    this.pending.set(true);
    this.error.set(null);
    try {
      await fn();
      this.ref.close(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      this.pending.set(false);
    }
  }
}
