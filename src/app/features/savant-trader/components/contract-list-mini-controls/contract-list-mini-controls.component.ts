/**
 * Contract-list chunk mini-controls (#1363) — the page-level strip over
 * the plotted-chips row, rendered only while a contract-list session is
 * active. A dumb surface: every control calls an existing
 * ContractListSessionStore method and routes emitted lines through the
 * `send` output — the page writes them into the pairs textarea and calls
 * the existing loadPlotted path (same seam as the picker's `onSend`).
 */
import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ContractListSessionStore } from '../../stores/contract-list-session.store';
import { CHUNK_SIZE_OPTIONS } from '../../utils/contract-list-session-settings';

@Component({
  selector: 'app-list-mini-controls',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './contract-list-mini-controls.component.html',
  styleUrl: './contract-list-mini-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListMiniControlsComponent {
  readonly store = inject(ContractListSessionStore);
  readonly chunkSizeOptions = CHUNK_SIZE_OPTIONS;

  /** Emitted `date,contractId` lines for the page's load path. */
  readonly send = output<string[]>();
  /** Reopen the picker dialog — the page owns the dialog ref/dedupe. */
  readonly openPicker = output<void>();

  /** ◀▶ live-drive — the store owns the step-then-emit ordering. */
  step(dir: number): void {
    this.send.emit(this.store.sendSteppedChunk(dir));
  }

  /** "All" on this surface means select every pick AND plot them —
   *  select-only would be invisible without a dialog open. The store
   *  owns the select-then-emit ordering. */
  sendAll(): void {
    this.send.emit(this.store.sendAll());
  }

  /** Repartition only — resizing never emits. */
  setChunkSize(n: number): void {
    this.store.setChunkSize(n);
  }
}
