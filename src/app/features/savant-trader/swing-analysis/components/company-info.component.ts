/**
 * CompanyInfoStripComponent — inline profile strip in the swing-analysis
 * page header. Shows every StSymbolProfile field so paging prev/next
 * lands with full company context (PRD US-2).
 *
 * `profile.name` is the display-name SOT (US-3) — a tracked symbol with
 * no synced profile shows its ticker and em-dashes, never a partner name.
 */
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { tierLabel, fmtCap, fmtNum, fmtMoney, fmtPct } from '../../utils/utils';
import type { StSymbolProfile } from '../../services/types';

const DASH = '—';

@Component({
  selector: 'app-company-info',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="company-info" data-testid="company-info">
      <span class="ci-name">{{ name() }}</span>
      @for (f of fields(); track f.label) {
        <span class="ci-field" [attr.title]="f.title"><span class="ci-label">{{ f.label }}</span> {{ f.value }}</span>
      }
    </div>
  `,
  styles: [`
    .company-info {
      display: flex; flex-wrap: wrap; align-items: baseline;
      gap: 4px 14px; font-size: 12px; color: var(--mat-sys-on-surface-variant, #888);
      min-width: 0;
    }
    .ci-name { font-weight: 600; color: var(--mat-sys-on-surface, #ddd); }
    .ci-field { white-space: nowrap; }
    .ci-label { opacity: 0.65; margin-right: 2px; }
  `],
})
export class CompanyInfoStripComponent {
  symbol = input.required<string>();
  profile = input<StSymbolProfile | undefined>();

  protected readonly name = computed(() => {
    const n = this.profile()?.name;
    return n ? `${this.symbol()} — ${n}` : this.symbol();
  });

  protected readonly fields = computed(() => {
    const p = this.profile();
    const has52w = p?.week52Low != null || p?.week52High != null;
    return [
      { label: 'Sector', title: 'Sector', value: p?.sector ?? DASH },
      { label: 'Industry', title: 'Industry', value: p?.industry ?? DASH },
      { label: 'Exch', title: 'Exchange', value: p?.exchange ?? DASH },
      { label: 'Cap', title: 'Market cap', value: fmtCap(p?.marketCap) },
      { label: 'Tier', title: 'Market-cap tier', value: p?.marketCapTier ? tierLabel(p.marketCapTier) : DASH },
      { label: 'β', title: 'Beta', value: fmtNum(p?.beta) },
      { label: 'P/E', title: 'Price/earnings ratio', value: fmtNum(p?.peRatio, 1) },
      { label: '52w', title: '52-week range', value: has52w ? `${fmtMoney(p?.week52Low)} – ${fmtMoney(p?.week52High)}` : DASH },
      { label: 'MA50', title: '50-day moving average', value: fmtMoney(p?.ma50) },
      { label: 'MA200', title: '200-day moving average', value: fmtMoney(p?.ma200) },
      { label: 'Yield', title: 'Dividend yield', value: fmtPct(p?.dividendYield) },
    ];
  });
}
