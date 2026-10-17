/**
 * Hover popup for a chain-grid cell — the full contract payload.
 *
 * Presentational: takes a ChainCell and renders every field, 'n/a' for
 * missing values. Rendered inside a cdkConnectedOverlay owned by the grid.
 * Interactive since #965 (copy-contract button) — the grid owns the
 * delayed-close grace that lets the pointer travel icon → popup.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import type { ChainCell } from '../utils/chain.utils';
import { parseNumOrNull } from '../../../utils/contract-observation.utils';

function money(v: string | undefined): string {
  const n = parseNumOrNull(v);
  return n !== null ? `$${n.toFixed(2)}` : 'n/a';
}

function int(v: string | undefined): string {
  const n = parseNumOrNull(v);
  return n !== null ? Math.round(n).toLocaleString('en-US') : 'n/a';
}

function greek(v: string | undefined): string {
  const n = parseNumOrNull(v);
  return n !== null ? n.toFixed(4) : 'n/a';
}

/** "3.00 × 120" — price × size, or n/a when either side is missing. */
function priceSize(price: string | undefined, size: string | undefined): string {
  const p = parseNumOrNull(price);
  const s = parseNumOrNull(size);
  if (p === null && s === null) return 'n/a';
  const pText = p !== null ? p.toFixed(2) : 'n/a';
  return s !== null ? `${pText} × ${Math.round(s)}` : pText;
}

/** How long the "copied" check shows after a successful write — exported
 *  so specs advance the same value instead of hardcoding a margin. */
export const POPUP_COPIED_MS = 1500;

@Component({
  selector: 'app-chain-cell-popup',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="chain-cell-popup">
      <div class="popup-id-row">
        <div class="popup-id">{{ cell().contractID }}</div>
        <button
          type="button"
          class="copy-btn"
          [attr.aria-label]="copied() ? 'Copied' : 'Copy contract id'"
          [title]="copied() ? 'Copied' : 'Copy contract id'"
          (click)="copyId()"
        >
          <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
        </button>
        <span class="sr-only" role="status">{{ copied() ? 'Contract id copied' : '' }}</span>
      </div>
      <div class="popup-sub">{{ cell().strike }} · {{ cell().expiration }}</div>
      <div class="popup-rows">
        @for (r of rows(); track r.label) {
          <div class="popup-row">
            <span class="popup-label">{{ r.label }}</span>
            <span class="popup-value">{{ r.value }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .chain-cell-popup {
      pointer-events: auto;
      min-width: 210px;
      padding: 8px 10px;
      background: #263238;
      color: #eceff1;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.35);
      font-size: 0.68rem;
      line-height: 1.3;
    }
    .popup-id-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .popup-id {
      font-weight: 700;
      font-size: 0.7rem;
      letter-spacing: 0.02em;
      margin-bottom: 1px;
    }
    .copy-btn {
      display: inline-flex;
      align-items: center;
      padding: 2px;
      border: none;
      border-radius: 3px;
      background: transparent;
      color: #b0bec5;
      cursor: pointer;
      line-height: 0;
    }
    .copy-btn:hover { color: #eceff1; background: rgba(255,255,255,0.08); }
    .copy-btn mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }
    .popup-sub {
      opacity: 0.7;
      font-size: 0.6rem;
      margin-bottom: 6px;
    }
    .popup-rows {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .popup-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    .popup-label { opacity: 0.65; }
    .popup-value { font-variant-numeric: tabular-nums; font-weight: 500; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainCellPopupComponent {
  private readonly snackBar = inject(MatSnackBar);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly cell = input.required<ChainCell>();

  /** Brief "copied" check-icon state after a successful clipboard write. */
  readonly copied = signal(false);

  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearCopiedTimer());
    // The grid reuses this popup instance when the pointer hops icon A →
    // icon B inside the grace window — the check icon belongs to the
    // cell that was copied, not to the surface, so reset on re-input.
    effect(() => {
      this.cell();
      this.copied.set(false);
      this.clearCopiedTimer();
    });
  }

  /** Move keyboard focus into the popup — the grid calls this when the
   *  user presses Enter on the armed icon (#965 keyboard path). */
  focusCopyButton(): void {
    this.el.nativeElement.querySelector<HTMLElement>('.copy-btn')?.focus();
  }

  /** True while a descendant holds focus — the grid must not tear the
   *  overlay down under a focused button (pointer drift + keyboard). */
  containsFocus(): boolean {
    return this.el.nativeElement.contains(document.activeElement);
  }

  private clearCopiedTimer(): void {
    if (this.copiedTimer !== null) {
      clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
  }

  /** #965 — copy the raw OCC contract id so it can be pasted into the
   *  gallery dialog's Option tab (resolves via parseOptionPaste). */
  async copyId(): Promise<void> {
    const cell = this.cell();
    try {
      await navigator.clipboard.writeText(cell.contractID);
      // A stale continuation mustn't flag 'copied' on a different cell
      // after an A→B hop (#965 review r2).
      if (this.cell() !== cell) return;
      this.copied.set(true);
      this.clearCopiedTimer();
      this.copiedTimer = setTimeout(() => {
        this.copiedTimer = null;
        this.copied.set(false);
      }, POPUP_COPIED_MS);
    } catch {
      this.snackBar.open('Could not copy contract id', 'Dismiss', { duration: 3000 });
    }
  }

  /** Label/value pairs — precomputed so the template is render-only. */
  readonly rows = computed(() => {
    const cell = this.cell();
    const c = cell.contract;
    return [
      { label: 'Mark', value: cell.markText },
      { label: 'Last', value: money(c.last) },
      { label: 'Bid × Size', value: priceSize(c.bid, c.bid_size) },
      { label: 'Ask × Size', value: priceSize(c.ask, c.ask_size) },
      { label: 'Volume', value: int(c.volume) },
      { label: 'Open Interest', value: int(c.open_interest) },
      { label: 'IV', value: cell.ivText },
      { label: 'Delta', value: cell.deltaText },
      { label: 'Gamma', value: greek(c.gamma) },
      { label: 'Theta', value: greek(c.theta) },
      { label: 'Vega', value: greek(c.vega) },
      { label: 'Rho', value: greek(c.rho) },
      { label: 'Chg', value: cell.chgText },
      {
        label: 'Prior Mark',
        value: cell.priorMark !== null ? `$${cell.priorMark.toFixed(2)}` : 'n/a',
      },
    ];
  });
}
