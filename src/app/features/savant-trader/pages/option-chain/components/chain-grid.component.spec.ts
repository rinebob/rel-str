import { TestBed } from '@angular/core/testing';

import { ChainGridComponent, type ChainCellHover } from './chain-grid.component';
import { buildChainGrid } from '../utils/chain.utils';
import type { HistoricalOptionContract } from '@options-contract/contracts';
import { OptionType } from '@options-contract/contracts';

function oc(over: Partial<HistoricalOptionContract> = {}): HistoricalOptionContract {
  return {
    contractID: 'SPY_2026-10-16_600C',
    symbol: 'SPY',
    expiration: '2026-10-16',
    strike: '600',
    type: OptionType.CALL,
    mark: '2.50',
    implied_volatility: '0.32',
    delta: '0.55',
    ...over,
  };
}

describe('ChainGridComponent', () => {
  async function render(
    session: HistoricalOptionContract[],
    prior: HistoricalOptionContract[] = [],
    side: OptionType = OptionType.CALL,
    spot: number | null = null,
    sessionDate: string | null = null,
  ) {
    await TestBed.configureTestingModule({
      imports: [ChainGridComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChainGridComponent);
    fixture.componentRef.setInput('model', buildChainGrid(session, prior, side, spot));
    fixture.componentRef.setInput('side', side);
    fixture.componentRef.setInput('sessionDate', sessionDate);
    fixture.detectChanges();
    return fixture;
  }

  it('renders strikes as rows and expirations as columns', async () => {
    const fixture = await render([
      oc({ contractID: 'a', strike: '600', expiration: '2026-10-16' }),
      oc({ contractID: 'b', strike: '605', expiration: '2026-11-20' }),
    ]);
    const el: HTMLElement = fixture.nativeElement;

    const headers = Array.from(el.querySelectorAll('.header-cell')).map((h) => h.textContent!.trim());
    expect(headers.some((h) => h.includes('2026-10-16'))).toBe(true);
    expect(headers.some((h) => h.includes('2026-11-20'))).toBe(true);

    const rowHeaders = Array.from(el.querySelectorAll('.row-header')).map((h) => h.textContent!.trim());
    expect(rowHeaders).toEqual(['605', '600']); // desc: high strike on top
  });

  it('shows mark, chg, delta, and IV in each cell', async () => {
    const fixture = await render(
      [oc({ contractID: 'a', mark: '2.75', delta: '0.55', implied_volatility: '0.32' })],
      [oc({ contractID: 'a', mark: '2.50' })],
    );
    const cell: HTMLElement | null = fixture.nativeElement.querySelector('[data-cid="a"]');
    expect(cell?.textContent).toContain('$2.75');
    expect(cell?.textContent).toContain('+$0.25 / +10.0%');
    expect(cell?.textContent).toContain('0.55');
    expect(cell?.textContent).toContain('32.0%');
  });

  it('shows n/a when mark is missing (no last fallback)', async () => {
    const fixture = await render([oc({ contractID: 'a', mark: undefined, last: '9.99' })]);
    const cell: HTMLElement | null = fixture.nativeElement.querySelector('[data-cid="a"]');
    expect(cell?.textContent).toContain('n/a');
    expect(cell?.textContent).not.toContain('9.99');
  });

  it('shows chg n/a when no prior contract matches', async () => {
    const fixture = await render([oc({ contractID: 'a' })]);
    const chg = fixture.nativeElement.querySelector('[data-cid="a"] .cell-chg');
    expect(chg?.textContent).toContain('n/a');
  });

  it('shows DOW + DTE sub-labels in expiration headers when a session date is set', async () => {
    const fixture = await render(
      [oc({ contractID: 'a', expiration: '2026-10-16' })],
      [],
      OptionType.CALL,
      null,
      '2026-09-22',
    );
    const header = fixture.nativeElement.querySelector('.header-cell:nth-child(2)');
    expect(header?.textContent).toContain('2026-10-16');
    expect(header?.textContent).toContain('Fri');
    expect(header?.textContent).toContain('24d');
  });

  it('tags row headers with data-strike and marks the ATM row', async () => {
    const fixture = await render(
      [
        oc({ contractID: 'a', strike: '595' }),
        oc({ contractID: 'b', strike: '600' }),
        oc({ contractID: 'c', strike: '605' }),
      ],
      [],
      OptionType.CALL,
      601,
    );
    const el: HTMLElement = fixture.nativeElement;

    const headers = Array.from(el.querySelectorAll<HTMLElement>('.row-header'));
    expect(headers.map((h) => h.dataset['strike'])).toEqual(['605', '600', '595']);
    expect(el.querySelector('.row-header.atm')?.textContent).toContain('600');
    expect(el.querySelectorAll('.data-cell.atm').length).toBe(1);
  });

  it('renders the empty message when no contracts match', async () => {
    const fixture = await render([]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('No contracts matched the current filters.');
  });

  it('emits cellEnter with the cell + element on hover (delegated handler)', async () => {
    const fixture = await render([oc({ contractID: 'a' })]);
    const el: HTMLElement = fixture.nativeElement;
    const hovers: ChainCellHover[] = [];
    fixture.componentInstance.cellEnter.subscribe((h) => hovers.push(h));

    const mark = el.querySelector<HTMLElement>('[data-cid="a"] .cell-mark')!;
    mark.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();

    expect(hovers.length).toBe(1);
    expect(hovers[0].cell.contractID).toBe('a');
    expect(hovers[0].target.dataset['cid']).toBe('a');
  });

  it('emits cellLeave when the pointer exits a cell', async () => {
    const fixture = await render([oc({ contractID: 'a' })]);
    const el: HTMLElement = fixture.nativeElement;
    let leaves = 0;
    fixture.componentInstance.cellLeave.subscribe(() => leaves++);

    const cell = el.querySelector<HTMLElement>('[data-cid="a"]')!;
    cell.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    fixture.detectChanges();

    expect(leaves).toBe(1);
  });

  it('suppresses intra-cell transitions — one enter/leave pair per cell visit', async () => {
    const fixture = await render([oc({ contractID: 'a' })]);
    const el: HTMLElement = fixture.nativeElement;
    const hovers: ChainCellHover[] = [];
    let leaves = 0;
    fixture.componentInstance.cellEnter.subscribe((h) => hovers.push(h));
    fixture.componentInstance.cellLeave.subscribe(() => leaves++);

    const cell = el.querySelector<HTMLElement>('[data-cid="a"]')!;
    const mark = el.querySelector<HTMLElement>('[data-cid="a"] .cell-mark')!;
    const chg = el.querySelector<HTMLElement>('[data-cid="a"] .cell-chg')!;

    // Enter the cell via the mark span, move to the chg span (intra-cell),
    // then exit the cell entirely.
    mark.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    mark.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: chg }));
    chg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: mark }));
    chg.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: cell.parentElement }));
    fixture.detectChanges();

    expect(hovers.length).toBe(1);
    expect(leaves).toBe(1);
  });

  it('does not emit on header or empty cells', async () => {
    const fixture = await render([oc({ contractID: 'a' })]);
    const el: HTMLElement = fixture.nativeElement;
    const hovers: ChainCellHover[] = [];
    fixture.componentInstance.cellEnter.subscribe((h) => hovers.push(h));

    el.querySelector<HTMLElement>('.header-cell')!.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true }),
    );
    fixture.detectChanges();
    expect(hovers.length).toBe(0);
  });
});
