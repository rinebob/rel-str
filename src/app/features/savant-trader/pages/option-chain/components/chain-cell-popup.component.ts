/**
 * Hover popup for a chain-grid cell — the full contract payload.
 *
 * Presentational: takes a ChainCell and renders every field, 'n/a' for
 * missing values. Rendered inside a cdkConnectedOverlay owned by the grid;
 * pointer-events: none so it never steals hover from the cells beneath.
 */
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

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

@Component({
  selector: 'app-chain-cell-popup',
  standalone: true,
  template: `
    <div class="chain-cell-popup">
      <div class="popup-id">{{ cell().contractID }}</div>
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
      pointer-events: none;
      min-width: 210px;
      padding: 8px 10px;
      background: #263238;
      color: #eceff1;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.35);
      font-size: 0.68rem;
      line-height: 1.3;
    }
    .popup-id {
      font-weight: 700;
      font-size: 0.7rem;
      letter-spacing: 0.02em;
      margin-bottom: 1px;
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
  readonly cell = input.required<ChainCell>();

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
