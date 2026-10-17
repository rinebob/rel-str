/// <reference types="jest" />
import { TestBed } from '@angular/core/testing';

import { MatSnackBar } from '@angular/material/snack-bar';
import { ChainCellPopupComponent, POPUP_COPIED_MS } from './chain-cell-popup.component';
import { parseOptionPaste } from '../../../utils/option-contract.util';
import type { ChainCell } from '../utils/chain.utils';
import type { HistoricalOptionContract } from '@options-contract/contracts';
import { OptionType } from '@options-contract/contracts';

function contract(over: Partial<HistoricalOptionContract> = {}): HistoricalOptionContract {
  return {
    contractID: 'QQQ261016C00600000',
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
    contractID: 'QQQ261016C00600000',
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

/** Stub navigator.clipboard for a test — returns the writeText spy. */
function mockClipboard(writeText = jest.fn().mockResolvedValue(undefined)): jest.Mock {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

async function render(c: ChainCell) {
  await TestBed.configureTestingModule({
    imports: [ChainCellPopupComponent],
    providers: [{ provide: MatSnackBar, useValue: { open: jest.fn() } }],
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
    expect(text).toContain('QQQ261016C00600000');
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

  it('copy button writes the OCC contract id to the clipboard', async () => {
    const writeText = mockClipboard();
    const fixture = await render(cell());
    const btn: HTMLButtonElement | null = fixture.nativeElement.querySelector('.copy-btn');
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute('aria-label')).toBe('Copy contract id');

    jest.useFakeTimers();
    try {
      btn!.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      expect(writeText).toHaveBeenCalledWith('QQQ261016C00600000');
      expect(btn!.querySelector('mat-icon')?.textContent?.trim()).toBe('check');

      // Copied state reverts after the feedback window.
      jest.advanceTimersByTime(POPUP_COPIED_MS);
      fixture.detectChanges();
      expect(btn!.querySelector('mat-icon')?.textContent?.trim()).toBe('content_copy');
    } finally {
      jest.useRealTimers();
    }
  });

  it('the copied check resets when the popup is re-input for another cell', async () => {
    mockClipboard();
    const fixture = await render(cell());
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.copy-btn')!;

    btn.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(btn.querySelector('mat-icon')?.textContent?.trim()).toBe('check');

    // Icon-A → icon-B hop reuses this instance — cell B must not
    // inherit cell A's "copied" state (#965 review).
    fixture.componentRef.setInput('cell', cell({ contractID: 'QQQ261016C00610000' }));
    fixture.detectChanges();
    expect(btn.querySelector('mat-icon')?.textContent?.trim()).toBe('content_copy');
  });

  // AC2 — the copied payload is the raw OCC id; the Option tab's paste
  // field must resolve it via parseOptionPaste back to this contract.
  it('copied contract id round-trips through parseOptionPaste', async () => {
    const writeText = mockClipboard();
    const fixture = await render(cell());
    (fixture.nativeElement.querySelector('.copy-btn') as HTMLButtonElement).click();
    await fixture.whenStable();

    const parsed = parseOptionPaste(writeText.mock.calls[0][0]);
    expect(parsed).toEqual({ symbol: 'QQQ', expiration: '2026-10-16', strike: 600, type: 'call' });
  });

  it('copy failure surfaces a snackbar instead of failing silently', async () => {
    const writeText = mockClipboard(jest.fn().mockRejectedValue(new Error('denied')));
    const fixture = await render(cell());
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.copy-btn')!;

    btn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalled();
    // Icon does not claim success on failure.
    expect(btn.querySelector('mat-icon')?.textContent?.trim()).toBe('content_copy');
  });
});
