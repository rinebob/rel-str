/**
 * AllocationBucketDetailDialogComponent — the bucket detail dialog
 * (Blueprint #582 / task #591). A large dialog opened from a bucket row:
 * header carries the view-switcher (mat-select — swaps the viewed bucket
 * in place) + the bucket's stats strip; the body is a position carousel
 * (one position card at a time) plus the 'trade chart' slot — a stub
 * placeholder, spec TBD (PRD-noted dependency).
 *
 * Everything reads through `store.bucketDetail(viewingId)` inside a
 * computed — selector-driven, so attribution changes elsewhere (row
 * assign, bulk ops) re-derive the open dialog. A bucket deleted out
 * from under the dialog degrades to a message, not a crash.
 */
import { LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AllocationStore } from './allocation.store';
import { fmtDollars, fmtQty as fmtQtyShared, positionPnl, type PositionRow } from './allocation.types';

export interface BucketDetailDialogData {
  /** Captured at open — an account switch elsewhere can't silently swap
   *  the viewed bucket (same convention as the write dialogs). */
  accountNumber: string;
  bucketId: string;
}

@Component({
  selector: 'app-allocation-bucket-detail-dialog',
  imports: [LowerCasePipe, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatSelectModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title class="title-row">
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="bucket-picker">
        <mat-select [value]="viewingId()" (selectionChange)="switchBucket($event.value)"
          data-testid="bucket-switcher" aria-label="Viewed bucket">
          @for (b of buckets(); track b.id) {
            <mat-option [value]="b.id">
              {{ b.name }}@if (b.status !== 'ACTIVE') { ({{ b.status | lowercase }}) }
            </mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (detail(); as d) {
        <span class="meta dim">
          target {{ d.bucket.targetPct }}% · {{ d.bucket.status }}
        </span>
      }
    </h2>

    <mat-dialog-content>
      @if (detail(); as d) {
        <div class="stats-strip" data-testid="stats-strip">
          <span>Exposure <b>{{ fmt(d.stats.exposure) }}</b></span>
          <span>Target <b>{{ fmt(d.stats.targetDollars) }}</b></span>
          <span>Drift <b [class.neg]="d.stats.drift < 0">{{ fmt(d.stats.drift) }}</b></span>
          <span>Realized <b>{{ fmt(d.stats.realizedPnl) }}</b></span>
          <span>Unrealized <b>{{ fmt(d.stats.unrealizedPnl) }}</b></span>
          <span>Open/Closed <b>{{ d.stats.openCount }}/{{ d.stats.closedCount }}</b></span>
        </div>

        <div class="carousel" data-testid="position-carousel">
          @if (shown(); as pos) {
            <button mat-icon-button type="button" data-testid="carousel-prev"
              [disabled]="shownIdx() <= 0" aria-label="Previous position"
              (click)="idx.set(shownIdx() - 1)"
            ><mat-icon>chevron_left</mat-icon></button>
            <div class="pos-card">
              <div class="pos-head">
                <b>{{ pos.position.instrumentId }}</b>
                <span class="dim" data-testid="carousel-pager">{{ shownIdx() + 1 }} of {{ d.positions.length }}</span>
              </div>
              <div class="pos-stats">
                <span>Qty <b>{{ fmtQty(pos.position.quantity) }}</b></span>
                <span>Market value <b>{{ fmt(pos.position.marketValue) }}</b></span>
                <span>Cost basis <b>{{ fmt(pos.position.costBasis) }}</b></span>
                <span>Unrealized <b [class.neg]="pnlOf(pos) < 0">{{ fmt(pnlOf(pos)) }}</b></span>
              </div>
              @if (shownFills().length) {
                <div class="fills" data-testid="position-fills">
                  @for (f of shownFills(); track $index) {
                    <span class="fill-row">
                      {{ f.side }} {{ f.quantity }} @ {{ f.price }} · {{ fillDate(f.filledAt) }}
                    </span>
                  }
                </div>
              }
              <div class="chart-stub" data-testid="trade-chart-stub">
                Trade chart — spec TBD
              </div>
            </div>
            <button mat-icon-button type="button" data-testid="carousel-next"
              [disabled]="shownIdx() >= d.positions.length - 1" aria-label="Next position"
              (click)="idx.set(shownIdx() + 1)"
            ><mat-icon>chevron_right</mat-icon></button>
          } @else {
            <div class="empty">
              <div class="dim">No positions in this bucket</div>
              @if (bucketFills().length) {
                <div class="fills" data-testid="bucket-fills">
                  @for (f of bucketFills(); track $index) {
                    <span class="fill-row">
                      {{ f.instrumentId }} — {{ f.side }} {{ f.quantity }} @ {{ f.price }} · {{ fillDate(f.filledAt) }}
                    </span>
                  }
                </div>
              }
            </div>
          }
        </div>
      } @else {
        <div class="dim" data-testid="bucket-gone">
          This bucket no longer exists — it may have been deleted.
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button type="button" data-testid="dialog-close" (click)="ref.close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title-row { display: flex; align-items: center; gap: 12px; }
    .bucket-picker { min-width: 200px; font-size: 1rem; }
    .meta { font-size: 0.8rem; }
    mat-dialog-content { min-width: 420px; }
    .stats-strip { display: flex; flex-wrap: wrap; gap: 16px; font-size: 0.85rem; margin-bottom: 12px; }
    .carousel { display: flex; align-items: center; gap: 8px; min-height: 140px; }
    .pos-card { flex: 1; border: 1px solid #eee; border-radius: 6px; padding: 12px; }
    .pos-head { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .pos-stats { display: flex; flex-wrap: wrap; gap: 14px; font-size: 0.85rem; }
    .fills { margin-top: 10px; display: flex; flex-direction: column; gap: 2px; }
    .fill-row { font-size: 0.75rem; color: #666; font-variant-numeric: tabular-nums; }
    .chart-stub {
      margin-top: 10px; padding: 24px; text-align: center;
      border: 1px dashed #ccc; border-radius: 6px; color: #999; font-size: 0.8rem;
    }
    .dim { color: #999; }
    .empty { padding: 24px; text-align: center; width: 100%; }
    .neg { color: #c62828; }
  `],
})
export class AllocationBucketDetailDialogComponent {
  protected readonly data = inject<BucketDetailDialogData>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<AllocationBucketDetailDialogComponent>);
  protected readonly store = inject(AllocationStore);

  /** The bucket currently being viewed — switchable in place. */
  readonly viewingId = signal(this.data.bucketId);

  /** All buckets in the CAPTURED account — the switcher options (retired
   *  included; their stats still mean something). Reading the selected
   *  account here would list wrong-account buckets after a tab switch. */
  readonly buckets = computed(
    () => this.store.byAccount()[this.data.accountNumber]?.buckets ?? [],
  );

  /** Selector-driven detail — re-derives when store state changes.
   *  Account captured at open, not re-read per recompute. */
  readonly detail = computed(
    () => this.store.bucketDetail(this.data.accountNumber, this.viewingId()),
  );

  readonly idx = signal(0);

  constructor() {
    // Clamp the RAW index on shrink — otherwise a stale high idx jumps
    // the carousel forward again when positions regrow.
    effect(() => {
      const cap = Math.max(0, (this.detail()?.positions.length ?? 0) - 1);
      if (this.idx() > cap) this.idx.set(cap);
    });
  }

  /** Carousel index clamped to the live position count. */
  readonly shownIdx = computed(() => {
    const n = this.detail()?.positions.length ?? 0;
    return n === 0 ? 0 : Math.min(this.idx(), n - 1);
  });
  readonly shown = computed<PositionRow | null>(
    () => this.detail()?.positions[this.shownIdx()] ?? null,
  );

  /** Recent fills for the shown position (5 most recent, newest first) —
   *  PRD: the detail surface lists attributed orders alongside positions.
   *  alloc.fills order is raw broker-response order (typically
   *  newest-first), so sort explicitly before the tail slice. */
  readonly shownFills = computed(() => {
    const instrumentId = this.shown()?.position.instrumentId;
    if (!instrumentId) return [];
    return (this.detail()?.fills ?? [])
      .filter((f) => f.instrumentId === instrumentId)
      .sort((a, b) => Date.parse(b.filledAt) - Date.parse(a.filledAt))
      .slice(0, 5);
  });

  /** Bucket-level recent fills — shown only when the bucket has NO open
   *  positions (all-closed history would otherwise be unreachable, and
   *  the PRD requires positions AND orders in the detail surface). */
  readonly bucketFills = computed(() =>
    (this.detail()?.fills ?? [])
      .sort((a, b) => Date.parse(b.filledAt) - Date.parse(a.filledAt))
      .slice(0, 5),
  );

  switchBucket(id: string): void {
    this.viewingId.set(id);
    this.idx.set(0); // fresh carousel per bucket
  }

  /** YYYY-MM-DD when the timestamp parses; raw string otherwise —
   *  filledAt is only guaranteed Date.parse-able, not ISO-shaped. */
  fillDate(filledAt: string): string {
    const ms = Date.parse(filledAt);
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : filledAt;
  }

  readonly pnlOf = positionPnl;

  readonly fmt = fmtDollars;

  readonly fmtQty = fmtQtyShared;
}
