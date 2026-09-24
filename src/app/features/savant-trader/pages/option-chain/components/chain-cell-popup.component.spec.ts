/// <reference types="jest" />
import { TestBed } from '@angular/core/testing';

import { ChainCellPopupComponent } from './chain-cell-popup.component';
import type { ChainCell } from '../utils/chain.utils';
import type { HistoricalOptionContract } from '@options-contract/contracts';
import { OptionType } from '@options-contract/contracts';

function contract(over: Partial<HistoricalOptionContract> = {}): HistoricalOptionContract {
  return {
    contractID: 'QQQ251016C00600000',
    symbol: 'QQQ',
    expiration: '2026-10-16',
    strike: '600',
    type: OptionType.CALL,
    last: '3.10',
    mark: '3.05',
    bid: '3.00',
    bid_size: '120',
    ask: '3.10',
    ask_size: '85',
    volume: '4200',
    open_interest: '9100',
    implied_volatility: '0.25',
    delta: '0.55',
    gamma: '0.012',
    theta: '-0.08',
    vega: '0.31',
    rho: '0.15',
    ...over,
  };
}

function cell(over: Partial<ChainCell> = {}): ChainCell {
  return {
    contractID: 'QQQ251016C00600000',
    expiration: '2026-10-16',
    strike: 600,
    mark: 3.05,
    priorMark: 2.80,
    chgAbs: 0.25,
    chgPct: 0.0893,
    delta: 0.55,
    iv: 0.25,
    deltaShaded: true,
    volume: 1234,
    openInterest: 5678,
    markText: '$3.05',
    chgText: '+$0.25 / +8.9%',
    deltaText: '0.55',
    ivText: '25.0%',
    volText: 'V 1.2k',
    oiText: 'OI 5.7k',
    contract: contract(),
    ...over,
  };
}

async function render(c: ChainCell) {
  await TestBed.configureTestingModule({
    imports: [ChainCellPopupComponent],
  }).compileComponents();
  const fixture = TestBed.createComponent(ChainCellPopupComponent);
  fixture.componentRef.setInput('cell', c);
  fixture.detectChanges();
  return fixture;
}

describe('ChainCellPopupComponent', () => {
  it('renders the full contract payload', async () => {
    const fixture = await render(cell());
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('QQQ251016C00600000');
    expect(text).toContain('$3.05'); // mark
    expect(text).toContain('$3.10'); // last
    expect(text).toContain('3.00'); // bid
    expect(text).toContain('120'); // bid size
    expect(text).toContain('4,200'); // volume
    expect(text).toContain('9,100'); // OI
    expect(text).toContain('25.0%'); // IV
    expect(text).toContain('0.55'); // delta
    expect(text).toContain('0.012'); // gamma
    expect(text).toContain('-0.08'); // theta
    expect(text).toContain('0.31'); // vega
    expect(text).toContain('0.15'); // rho
    expect(text).toContain('+$0.25 / +8.9%'); // chg
    expect(text).toContain('$2.80'); // prior mark
  });

  it('renders n/a for missing fields instead of blank or crash', async () => {
    const fixture = await render(
      cell({
        mark: null,
        markText: 'n/a',
        priorMark: null,
        chgText: 'n/a',
        contract: contract({ last: undefined, volume: undefined, gamma: undefined }),
      }),
    );
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('n/a');
    // No 'undefined'/'null'/'NaN' leaks into the view.
    expect(text).not.toMatch(/undefined|null|NaN/);
  });

  it('renders empty-string fields as n/a — Number("") is 0 but blank means missing', async () => {
    const fixture = await render(
      cell({ contract: contract({ last: '', volume: '', open_interest: '' }) }),
    );
    const text: string = fixture.nativeElement.textContent;
    // Last/Volume/OI rows must show n/a — not '$0.00'/'0'.
    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.popup-row'),
    ) as HTMLElement[];
    const rowText = (label: string) =>
      rows.find((r) => r.textContent?.startsWith(label))?.textContent ?? '';
    expect(rowText('Last')).toContain('n/a');
    expect(rowText('Volume')).toContain('n/a');
    expect(rowText('Open Interest')).toContain('n/a');
  });
});
