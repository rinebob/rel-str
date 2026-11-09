/**
 * Chart emit plumbing — turns textarea lines / programmatic sends into
 * parse → confirm → loadPlotted/loadContract, and surfaces rejected
 * tokens. Page-scoped: provided by the component, dies with the page.
 */
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { DsDialogService } from '../../../../shared/ds/ds-dialog';
import { ConfirmDialogComponent } from '../../../../shared/ds/confirm-dialog.component';
import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import {
  parsePlottedEntries,
  type RejectedEntry,
  type RejectedReason,
} from '../../utils/plotted-pairs.util';
import { OptionChartPageService } from './option-chart-page.service';

/** Pasting more than this many contracts asks for confirmation first — the
 *  chart stays usable but the fetch batch and line count get unwieldy. */
const LARGE_LIST_WARN_THRESHOLD = 50;

@Injectable()
export class OptionChartLoadService {
  private readonly page = inject(OptionChartPageService);
  private readonly store = inject(OptionsContractViewerStore);
  private readonly dialog = inject(DsDialogService);

  /** Tokens rejected by the last pair-list parse, shown as a notice. */
  readonly rejectedEntries = signal<RejectedEntry[]>([]);

  /** Re-entrancy flag for the >50 confirm — the only dialog that must
   *  block a second load. Scoped narrower than `openDialogs.length`:
   *  sends legitimately arrive while another dialog (chooser, a picker
   *  mid-close) is still registered open — an any-dialog check would
   *  dead-end them. */
  private loadConfirmOpen = false;

  /** Load dispatch: a single bare OCC ID keeps the existing single-contract
   *  view; anything else — dated pairs or a multi-line list — goes through
   *  the plotted-set path. Rejected tokens are surfaced, valid entries still
   *  load. `sentLines` is the programmatic-send variant (picker/generator):
   *  the textarea write is deferred past the >50 confirm so a cancelled
   *  send can't leave the field disagreeing with the plotted set. */
  async onLoad(sentLines?: string): Promise<void> {
    const text = sentLines ?? this.page.occIdInput;
    // Re-entrancy guard: a second click while the >50 confirm is open would
    // stack another dialog and spawn a concurrent batch.
    if (!text.trim() || this.loadConfirmOpen) return;

    const { entries, rejected } = parsePlottedEntries(text, this.page.symbol());
    this.rejectedEntries.set(rejected);
    if (entries.length === 0) return;

    if (entries.length === 1 && entries[0].openDate === null && rejected.length === 0) {
      if (sentLines !== undefined) this.page.occIdInput = text;
      this.store.loadContract(entries[0].contractId, this.store.contractLength());
      return;
    }

    if (entries.length > LARGE_LIST_WARN_THRESHOLD) {
      this.loadConfirmOpen = true;
      try {
        const ok = await firstValueFrom(
          this.dialog
            .open(ConfirmDialogComponent, {
              data: {
                message: `This will load ${entries.length} option contracts — the chart may be slow and hard to read. Load all ${entries.length}?`,
                confirmLabel: 'Load',
                cancelLabel: 'Cancel',
              },
            })
            .afterClosed(),
        );
        if (!ok) return;
      } finally {
        this.loadConfirmOpen = false;
      }
    }

    if (sentLines !== undefined) this.page.occIdInput = text;
    await this.store.loadPlotted(entries);
  }

  /** Send handoff — drawer/picker emits pair lines through the same
   *  textarea + loadPlotted path as a paste, so replace semantics stay
   *  identical. A pending >50 confirm drops the send rather than
   *  queueing a load the user hasn't approved. */
  emitLinesToChart(lines: string[]): void {
    if (this.loadConfirmOpen) return;
    void this.onLoad(lines.join('\n'));
  }

  rejectionReasonLabel(reason: RejectedReason): string {
    switch (reason) {
      case 'invalid-contract':
        return 'not a valid contract ID';
      case 'invalid-date':
        return 'invalid date (use YYYY-MM-DD)';
      case 'wrong-underlying':
        return `not a ${(this.page.symbol() || '').trim().toUpperCase()} contract`;
    }
  }
}
