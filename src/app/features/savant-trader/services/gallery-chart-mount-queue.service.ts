/**
 * Gallery Chart Mount Queue (#860)
 *
 * Paces Syncfusion chart mounts across animation frames: each grant is one
 * mount's worth of synchronous render work, so a viewport of gallery cards
 * (flat layout especially) streams in one-per-frame instead of blocking a
 * single change-detection pass. Grants run inside rAF — mount work is
 * render work, so it lands immediately before its frame's paint.
 *
 * Unmounts never go through here — leaving is cheap and must be immediate.
 */
import { Injectable } from '@angular/core';

/** Max chart mounts granted per animation frame. */
export const CHART_MOUNTS_PER_FRAME = 1;

@Injectable({ providedIn: 'root' })
export class GalleryChartMountQueueService {
  private readonly pending: { run: () => void; stillValid?: () => boolean }[] = [];
  private scheduled = false;

  /** Queue a mount; `run` executes on a future frame (FIFO). `stillValid`
   *  is re-checked at flush time — an invalidated request is skipped WITHOUT
   *  consuming the frame's grant budget, so a scroll burst's dead grants
   *  can't starve mounts behind them (#860 review). */
  request(run: () => void, stillValid?: () => boolean): void {
    this.pending.push({ run, stillValid });
    if (!this.scheduled) {
      this.scheduled = true;
      requestAnimationFrame(() => this.flushFrame());
    }
  }

  private flushFrame(): void {
    this.scheduled = false;
    try {
      let granted = 0;
      while (granted < CHART_MOUNTS_PER_FRAME && this.pending.length) {
        const entry = this.pending.shift()!;
        if (entry.stillValid && !entry.stillValid()) continue; // dead grant — free
        entry.run();
        granted++;
      }
    } finally {
      // A grant may re-queue mid-flush — request() already armed the next
      // frame; without this guard the tail would schedule a second one and
      // two grants would fire in the same frame. finally so a throwing
      // grant can't strand the queue either.
      if (this.pending.length && !this.scheduled) {
        this.scheduled = true;
        requestAnimationFrame(() => this.flushFrame());
      }
    }
  }
}
