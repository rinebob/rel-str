/**
 * Options Replay Contract-Series Dialog
 *
 * Lazily fetches one contract's historical mark series via
 * `getHistoricalOptionsContract$` and renders a single mark line —
 * no span markers or extra panes (that's the chart viewer's job).
 * Loading → line / empty / error states; the error state names the
 * contractId. Nothing is persisted client-side.
 */
import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { OptionsContractService } from '../../../services/options-contract.service';

export interface ContractSeriesDialogData {
  symbol: string;
  contractId: string;
  /** Position entry date — shown for context in the dialog header. */
  entryDate: string;
}

interface SeriesPoint {
  date: string;
  mark: number;
}

const W = 560;
const H = 220;
const PAD_X = 48;
const PAD_TOP = 12;
const PLOT_H = 160;
const PLOT_W = W - PAD_X * 2;

type FetchState = 'loading' | 'loaded' | 'empty' | 'error';

@Component({
  selector: 'app-options-replay-contract-series-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './options-replay-contract-series-dialog.component.html',
  styleUrl: './options-replay-contract-series-dialog.component.scss',
})
export class OptionsReplayContractSeriesDialogComponent {
  private readonly optionsContractService = inject(OptionsContractService);
  readonly data = inject<ContractSeriesDialogData>(MAT_DIALOG_DATA);

  readonly state = signal<FetchState>('loading');
  readonly errorMessage = signal<string>('');
  readonly series = signal<SeriesPoint[]>([]);

  readonly W = W;
  readonly H = H;
  readonly PAD_X = PAD_X;
  readonly PLOT_W = PLOT_W;

  constructor() {
    this.optionsContractService
      .getHistoricalOptionsContract$(this.data.symbol, this.data.contractId)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (response) => {
          const points = (response.series ?? [])
            .map((obs) => ({ date: obs.date, mark: Number(obs.mark) }))
            .filter((p) => p.date && Number.isFinite(p.mark));
          this.series.set(points);
          this.state.set(points.length ? 'loaded' : 'empty');
        },
        error: (err: unknown) => {
          this.errorMessage.set(err instanceof Error ? err.message : String(err));
          this.state.set('error');
        },
      });
  }

  private readonly yScale = computed(() => {
    const values = this.series().map((p) => p.mark);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    if (span === 0 || !Number.isFinite(span)) return () => PAD_TOP + PLOT_H / 2;
    return (v: number) => PAD_TOP + (1 - (v - min) / span) * PLOT_H;
  });

  private xAt(i: number): number {
    const n = this.series().length;
    if (n <= 1) return PAD_X + PLOT_W / 2;
    return PAD_X + (i / (n - 1)) * PLOT_W;
  }

  /** Polyline points string for the mark line. */
  readonly markPoints = computed(() =>
    this.series()
      .map((p, i) => `${this.xAt(i).toFixed(1)},${this.yScale()(p.mark).toFixed(1)}`)
      .join(' ')
  );

  /** Scaled y for a single-observation series (rendered as one dot). */
  readonly singleDotY = computed(() => {
    const p = this.series()[0];
    return p ? this.yScale()(p.mark) : PAD_TOP + PLOT_H / 2;
  });

  /** Min/mid/max y-axis ticks, deduped by label (flat series → one tick). */
  readonly ticks = computed(() => {
    const values = this.series().map((p) => p.mark);
    if (!values.length) return [] as { y: number; label: string }[];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const scale = this.yScale();
    const out: { y: number; label: string }[] = [];
    const seen = new Set<string>();
    for (const v of [max, (min + max) / 2, min]) {
      const label = v.toFixed(2);
      if (seen.has(label)) continue;
      seen.add(label);
      out.push({ y: scale(v), label });
    }
    return out;
  });
}
