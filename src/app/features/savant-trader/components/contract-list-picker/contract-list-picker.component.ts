/**
 * Contract List Picker (#1362 — rows tab + lines preview).
 *
 * The selection dialog over the page-scoped contract-list session:
 * a provenance header, a rows tab (per-row checkboxes, toolbar ops —
 * all/none/invert/stride/random/range/filter — disabled no-selection
 * markers, ↻ repeat badges), and a lines preview that mirrors
 * `store.emittedLines()` exactly. Send calls `store.sendSelected()`,
 * forwards the lines through the page's `onSend` callback, and closes
 * — the chart only plots once the dialog is out of the way (#1419).
 * The Chunks tab (#1363) sits between Rows and Lines — a stepper and
 * click-to-toggle timeline over the doc window, and add-chunk
 * accumulation into the selection. Ticks shade by selection state and
 * a click toggles its chunk + jumps the cursor (#1420). Nothing here
 * emits — chunking is workspace navigation; `selection` is the only
 * thing that ever reaches the chart.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../shared/ds/ds-dialog';

import type { NoSelectionReason } from '@options-replay/contracts';
import { DAYS, daysBetween } from '../../../shared/utils/date.util';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';
import { CHUNK_SIZE_OPTIONS } from '../../utils/contract-list-session-settings';

type PickerTab = 'rows' | 'chunks' | 'lines';

interface TimelineTick {
  date: string;
  pct: number;
  inChunk: boolean;
  /** True when the day is in the selection — ticks shade by selection
   *  state (#1420), not just cursor position. */
  selected: boolean;
  /** True when EVERY day of the tick's chunk is selected — the click
   *  toggles the whole chunk, so aria-pressed reports the toggle's
   *  target state, not this day's (#1420 chunk-granular model). */
  chunkSelected: boolean;
  chunkIdx: number;
}

/** Dialog-data contract — the page injects the emit callback Send
 *  forwards the plotted lines through. */
export interface ContractListPickerData {
  onSend?: (lines: string[]) => void;
}

@Component({
  selector: 'app-contract-list-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contract-list-picker.component.html',
  styleUrl: './contract-list-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractListPickerComponent {
  protected readonly dialogRef = inject(DsDialogRef<ContractListPickerComponent>);
  /** Emit callback injected by the page — an explicit call rather than
   *  an `afterClosed` result keeps the emit synchronous and off the
   *  zoneless-effect seam (NG0914). Optional: the dialog still emits to
   *  `lastEmitted` when no callback is wired (tests). */
  private readonly data = inject<ContractListPickerData>(DS_DIALOG_DATA, {
    optional: true,
  });
  /** The page-scoped session — resolved from the opener's injector. */
  readonly store = inject(ContractListSessionStore);

  readonly canSend = computed(() => this.store.selectedRows().length > 0);
  /** Exact emit output for the current selection — the Lines tab body. */
  readonly linesText = computed(() => this.store.emittedLines().join('\n'));
  readonly rows = computed(() => this.store.activeList()?.rows ?? []);

  readonly activeTab = signal<PickerTab>('rows');

  readonly chunkSizeOptions = CHUNK_SIZE_OPTIONS;

  /** Timeline over the doc window: one tick per pick day, positioned by
   *  calendar distance between first/last. Ticks derive from `chunks()`
   *  so each tick's chunk binding IS the store's partition — no
   *  restated `floor(i / chunkSize)` rule to drift. `pickDocMeta` is
   *  required by doc validation, so no silent row-derived fallback. */
  readonly timeline = computed(() => {
    const meta = this.store.activeList()?.pickDocMeta;
    if (!meta || this.store.pickRows().length === 0) return null;
    const { firstDate: lo, lastDate: hi } = meta;
    const span = Math.max(1, daysBetween(lo, hi));
    const pct = (d: string) =>
      Math.min(100, Math.max(0, (daysBetween(lo, d) / span) * 100));
    const curIdx = this.store.chunkInfo().index;
    const cur = this.store.currentChunk();
    const sel = this.store.selection();
    let chunkSpan: { left: number; width: number } | null = null;
    if (cur.length) {
      const rawLeft = pct(cur[0].entryDate);
      // Single-day chunks still get a visible sliver; clamping `left`
      // (not `width`) keeps a doc-end sliver visible — clamping the
      // width alone collapses it to zero when left hits 100%.
      const width = Math.max(0.5, pct(cur[cur.length - 1].entryDate) - rawLeft);
      chunkSpan = { left: Math.min(rawLeft, 100 - width), width };
    }
    return {
      lo,
      hi,
      ticks: this.store.chunks().flatMap((chunk, chunkIdx) => {
        const allSelected = chunk.every((r) => sel.has(r.entryDate));
        return chunk.map(
          (r): TimelineTick => ({
            date: r.entryDate,
            pct: pct(r.entryDate),
            inChunk: chunkIdx === curIdx,
            selected: sel.has(r.entryDate),
            chunkSelected: allSelected,
            chunkIdx,
          }),
        );
      }),
      chunkSpan,
    };
  });

  // One-shot toolbar params — control values, not feature state (the
  // selection they produce lives in the store).
  readonly strideK = signal(2);
  readonly strideOptions = [2, 3, 5, 10, 20];
  readonly randomN = signal(10);
  readonly rangeFrom = signal('');
  readonly rangeTo = signal('');
  readonly filterText = signal('');
  readonly copied = signal(false);

  /** Emit the selection, close, then hand the lines to the page —
   *  `onSend` runs the >50-confirm/load path and must open on a clean
   *  page, not nested inside this dialog; closing first also means a
   *  thrown send can't strand the picker open (#1419). */
  send(): void {
    if (!this.canSend()) return;
    const lines = this.store.sendSelected();
    this.dialogRef.close();
    this.data?.onSend?.(lines);
  }

  /** Chunk stepper — cursor navigation only, never emits (#1419). */
  stepChunk(dir: number): void {
    this.store.step(dir);
  }

  /** Timeline tick click (#1420) — one store call toggles the chunk AND
   *  lands the cursor on it (a single patch+persist, so the saved blob
   *  can't hold a new selection under a stale cursor). Never emits.
   *  Day-level edits live on the Rows tab. */
  onTickClick(t: TimelineTick): void {
    this.store.toggleChunkAt(t.chunkIdx);
  }

  addChunk(): void {
    this.store.addChunkToSelection();
  }

  removeChunk(): void {
    this.store.removeChunkFromSelection();
  }

  onChunkSize(n: number): void {
    this.store.setChunkSize(n);
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.linesText());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard denied (permissions/insecure context) — no-op is the
      // right UX for a convenience button; the preview stays selectable.
    }
  }

  applyStride(): void {
    this.store.selectStride(this.strideK());
  }

  applyRandom(): void {
    if (this.randomN() < 1) return;
    this.store.randomPick(this.randomN());
  }

  applyRange(): void {
    if (!this.rangeFrom() || !this.rangeTo()) return;
    this.store.selectDateRange(this.rangeFrom(), this.rangeTo());
  }

  applyFilter(): void {
    const text = this.filterText().trim();
    if (text) this.store.selectContains(text);
  }

  onToggle(entryDate: string, event: Event): void {
    this.store.toggleRow(entryDate, (event.target as HTMLInputElement).checked);
  }

  dow(iso: string): string {
    return DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  }

  noSelectionLabel(reason?: NoSelectionReason): string {
    switch (reason) {
      case 'miss': return 'No pick — chain existed, nothing met the criteria (miss)';
      case 'gap': return 'No pick — market data gap (gap)';
      case 'out-of-range': return 'No pick — outside the doc window (out-of-range)';
      default: return 'No pick';
    }
  }

  /** WAI-ARIA tabs keyboard nav: arrows move + activate, Home/End jump.
   *  The tab order is read off the DOM ids (`picker-tab-{name}`) so a
   *  tab added to the template joins the nav without touching this
   *  handler — a hardcoded array and the template could drift apart. */
  onTabKeydown(event: KeyboardEvent): void {
    const tabs = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.tab'),
    );
    const count = tabs.length;
    if (count === 0) return;
    const order = tabs.map((t) => t.id.replace(/^picker-tab-/, '') as PickerTab);
    let next: number | null = null;
    const current = order.indexOf(this.activeTab());
    switch (event.key) {
      case 'ArrowRight': next = (current + 1) % count; break;
      case 'ArrowLeft': next = (current - 1 + count) % count; break;
      case 'Home': next = 0; break;
      case 'End': next = count - 1; break;
      default: return;
    }
    event.preventDefault();
    this.activeTab.set(order[next]);
    tabs[next]?.focus();
  }
}
