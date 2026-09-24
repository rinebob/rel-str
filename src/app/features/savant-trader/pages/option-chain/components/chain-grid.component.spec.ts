import { TestBed } from '@angular/core/testing';

import { ChainGridComponent } from './chain-grid.component';
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
    fixture.componentRef.setInput('model', buildChainGrid(session, prior, side, { spot }));
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
    // The heavy row box — the rightmost ATM cell carries .last-col so the
    // right edge of the border closes.
    expect(el.querySelector('.data-cell.atm.last-col')).not.toBeNull();
  });

  it('colors cells by chgPct on the same diverging ramp as pct-change', async () => {
    const fixture = await render(
      [
        oc({ contractID: 'up', strike: '600', mark: '3.00' }),
        oc({ contractID: 'dn', strike: '605', mark: '1.00' }),
        oc({ contractID: 'flat', strike: '610' }),
      ],
      [
        oc({ contractID: 'up', strike: '600', mark: '2.00' }),
        oc({ contractID: 'dn', strike: '605', mark: '2.00' }),
        // 'flat' has no prior — no chg, no gradient.
      ],
    );
    const el: HTMLElement = fixture.nativeElement;
    const up = el.querySelector<HTMLElement>('[data-cid="up"]')!;
    const dn = el.querySelector<HTMLElement>('[data-cid="dn"]')!;
    const flat = el.querySelector<HTMLElement>('[data-cid="flat"]')!;
    const [ur, ug] = up.style.backgroundColor.match(/\d+/g)!.map(Number);
    const [dr, dg] = dn.style.backgroundColor.match(/\d+/g)!.map(Number);
    expect(ug).toBeGreaterThan(ur); // +50% → green side of the ramp
    expect(dg).toBeLessThan(dr);    // −50% → red side
    expect(flat.style.backgroundColor).toBe('');
    expect(flat.classList.contains('colored')).toBe(false);
  });

  it('recomputes top-5 gainers when the model changes (e.g. filter cleared)', async () => {
    // 6 positive cells, one expiration — 'x' is the 6th-biggest gainer,
    // so it starts UNmarked. If the ring set were stale after a model
    // swap, 'x' could never gain the ring.
    const six = (priorScale: number) => {
      const session: HistoricalOptionContract[] = [];
      const prior: HistoricalOptionContract[] = [];
      for (let i = 0; i < 6; i++) {
        session.push(oc({ contractID: `c${i}`, strike: String(600 + i), mark: '2.00' }));
        prior.push(oc({ contractID: `c${i}`, strike: String(600 + i), mark: '1.00' }));
      }
      // 'x' — smallest gainer in model 1, biggest in model 2.
      session.push(oc({ contractID: 'x', strike: '620', mark: String(2.0 * priorScale) }));
      prior.push(oc({ contractID: 'x', strike: '620', mark: '2.00' }));
      return { session, prior };
    };
    let { session, prior } = six(0.5); // x: 2.00 → 1.00 = −50% — not top
    const fixture = await render(session, prior);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.data-cell.top-gainer').length).toBe(5);
    expect(el.querySelector('[data-cid="x"]')!.classList.contains('top-gainer')).toBe(false);

    ({ session, prior } = six(10)); // x: 2.00 → 20.00 = +900% — must gain the ring
    fixture.componentRef.setInput('model', buildChainGrid(session, prior, OptionType.CALL));
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="x"]')!.classList.contains('top-gainer')).toBe(true);
    // One of the flat 6 must have LOST its ring (only 5 slots).
    expect(el.querySelectorAll('.data-cell.top-gainer').length).toBe(5);
  });

  it('marks the top-5 positive gainers per expiration; penny cells excluded', async () => {
    const session: HistoricalOptionContract[] = [];
    const prior: HistoricalOptionContract[] = [];
    for (let i = 0; i < 7; i++) {
      session.push(oc({ contractID: `c${i}`, strike: String(600 + i), mark: '2.00' }));
      prior.push(oc({ contractID: `c${i}`, strike: String(600 + i), mark: '1.00' }));
    }
    session.push(oc({ contractID: 'penny', strike: '620', mark: '0.01' }));
    prior.push(oc({ contractID: 'penny', strike: '620', mark: '0.005' }));
    const fixture = await render(session, prior);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.data-cell.top-gainer').length).toBe(5);
    expect(
      el.querySelector<HTMLElement>('[data-cid="penny"]')!.classList.contains('top-gainer'),
    ).toBe(false);
  });

  it('topDirection losers marks the 5 most negative cells per expiration', async () => {
    const session: HistoricalOptionContract[] = [];
    const prior: HistoricalOptionContract[] = [];
    // 6 losers of increasing severity + 1 gainer. 'flat' is +100% — must
    // NOT be marked in losers mode; 'big' is −90% — must be marked.
    for (let i = 0; i < 6; i++) {
      const mark = (2.0 - i * 0.3).toFixed(2); // 2.00 … 0.50 vs prior 2.00
      session.push(oc({ contractID: `l${i}`, strike: String(600 + i), mark }));
      prior.push(oc({ contractID: `l${i}`, strike: String(600 + i), mark: '2.00' }));
    }
    session.push(oc({ contractID: 'flat', strike: '620', mark: '4.00' }));
    prior.push(oc({ contractID: 'flat', strike: '620', mark: '2.00' }));
    session.push(oc({ contractID: 'big', strike: '625', mark: '0.20' }));
    prior.push(oc({ contractID: 'big', strike: '625', mark: '2.00' }));

    const fixture = await render(session, prior);
    const el: HTMLElement = fixture.nativeElement;
    // Default gainers mode: 'flat' (+100%) marked, losers not.
    expect(el.querySelector('[data-cid="flat"]')!.classList.contains('top-gainer')).toBe(true);
    expect(el.querySelector('[data-cid="big"]')!.classList.contains('top-gainer')).toBe(false);

    fixture.componentRef.setInput('topDirection', 'losers');
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="big"]')!.classList.contains('top-gainer')).toBe(true);
    expect(el.querySelector('[data-cid="flat"]')!.classList.contains('top-gainer')).toBe(false);
    // 6 negative cells, only 5 slots.
    expect(el.querySelectorAll('.data-cell.top-gainer').length).toBe(5);
  });

  it('marks the first column of each new month and alternates the month tint', async () => {
    const fixture = await render([
      oc({ contractID: 'a', expiration: '2026-10-16' }),
      oc({ contractID: 'b', expiration: '2026-10-30', strike: '605' }),
      oc({ contractID: 'c', expiration: '2026-11-20', strike: '600' }),
    ]);
    const headers = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.header-cell:not(.corner-cell)',
      ) as NodeListOf<HTMLElement>,
    );
    expect(headers[0].classList.contains('month-start')).toBe(true);
    expect(headers[0].classList.contains('month-alt')).toBe(true);
    expect(headers[1].classList.contains('month-start')).toBe(false);
    expect(headers[1].classList.contains('month-alt')).toBe(true);
    expect(headers[2].classList.contains('month-start')).toBe(true);
    expect(headers[2].classList.contains('month-alt')).toBe(false);
  });

  it('deltaShading/timeShading inputs gate the shade classes', async () => {
    const fixture = await render([
      oc({ contractID: 'a', delta: '0.15', expiration: '2026-10-16' }),
      oc({ contractID: 'b', delta: '0.15', expiration: '2026-11-20', strike: '605' }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    const cellA = () => el.querySelector<HTMLElement>('[data-cid="a"]')!;
    const headers = () =>
      Array.from(
        el.querySelectorAll('.header-cell:not(.corner-cell)') as NodeListOf<HTMLElement>,
      );

    expect(cellA().classList.contains('delta-shaded')).toBe(true);
    expect(headers()[1].classList.contains('month-start')).toBe(true);

    fixture.componentRef.setInput('deltaShading', false);
    fixture.detectChanges();
    expect(cellA().classList.contains('delta-shaded')).toBe(false);

    fixture.componentRef.setInput('timeShading', false);
    fixture.detectChanges();
    expect(headers()[1].classList.contains('month-start')).toBe(false);
  });

  it('heatmap input gates the gradient and top-gainer ring together', async () => {
    const fixture = await render(
      [oc({ contractID: 'a', mark: '3.00' })],
      [oc({ contractID: 'a', mark: '2.00' })],
    );
    const el: HTMLElement = fixture.nativeElement;
    const cellA = () => el.querySelector<HTMLElement>('[data-cid="a"]')!;

    expect(cellA().style.backgroundColor).toMatch(/rgb/);
    expect(cellA().classList.contains('top-gainer')).toBe(true);

    fixture.componentRef.setInput('heatmap', false);
    fixture.detectChanges();
    expect(cellA().style.backgroundColor).toBe('');
    expect(cellA().classList.contains('top-gainer')).toBe(false);
    expect(cellA().classList.contains('colored')).toBe(false);
  });

  it('renders the empty message when no contracts match', async () => {
    const fixture = await render([]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('No contracts matched the current filters.');
  });

  it('cell hover reveals the icon; icon hover opens the popup; icon leave closes it', async () => {
    const fixture = await render([
      oc({ contractID: 'CALL-A', strike: '600' }),
      oc({ contractID: 'CALL-B', strike: '605' }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    const cellA = el.querySelector<HTMLElement>('[data-cid="CALL-A"]')!;
    const cellB = el.querySelector<HTMLElement>('[data-cid="CALL-B"]')!;
    const popups = () => document.querySelectorAll('.chain-cell-popup');

    // Cell hover reveals the icon but does NOT open the popup.
    cellA.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();
    const iconA = cellA.querySelector<HTMLElement>('.popup-icon-btn')!;
    expect(iconA).toBeTruthy();
    expect(popups().length).toBe(0);

    // Icon hover opens the popup for that cell's contract.
    iconA.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: cellA }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(popups().length).toBe(1);
    expect(popups()[0].textContent).toContain('CALL-A');

    // Icon leave into the cell body closes the popup; icon stays.
    iconA.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: cellA }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(popups().length).toBe(0);
    expect(cellA.querySelector('.popup-icon-btn')).toBeTruthy();

    // Moving to another cell moves the icon; popup stays closed.
    cellA.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: cellB }));
    cellB.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: cellA }));
    fixture.detectChanges();
    expect(cellA.querySelector('.popup-icon-btn')).toBeFalsy();
    expect(cellB.querySelector('.popup-icon-btn')).toBeTruthy();
    expect(popups().length).toBe(0);
  });

  it('reveals a labeled popup icon on cell hover, hides it on exit', async () => {
    const fixture = await render([oc({ contractID: 'a' })]);
    const el: HTMLElement = fixture.nativeElement;

    const mark = el.querySelector<HTMLElement>('[data-cid="a"] .cell-mark')!;
    mark.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();

    const icon = el.querySelector<HTMLElement>('[data-cid="a"] .popup-icon-btn');
    expect(icon).toBeTruthy();
    expect(icon!.getAttribute('aria-label')).toBe('Show contract details');

    const cell = el.querySelector<HTMLElement>('[data-cid="a"]')!;
    cell.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: cell.parentElement }),
    );
    fixture.detectChanges();
    expect(el.querySelector('.popup-icon-btn')).toBeFalsy();
  });

  it('suppresses intra-cell transitions — icon stays armed per cell visit', async () => {
    const fixture = await render([oc({ contractID: 'a' })]);
    const el: HTMLElement = fixture.nativeElement;
    const cell = el.querySelector<HTMLElement>('[data-cid="a"]')!;
    const mark = cell.querySelector<HTMLElement>('.cell-mark')!;
    const chg = cell.querySelector<HTMLElement>('.cell-chg')!;

    // Enter via mark, move to chg (intra-cell), exit the cell entirely —
    // the icon must appear once and disappear once.
    mark.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();
    mark.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: chg }));
    chg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: mark }));
    fixture.detectChanges();
    expect(cell.querySelector('.popup-icon-btn')).toBeTruthy();

    chg.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: cell.parentElement }),
    );
    fixture.detectChanges();
    expect(el.querySelector('.popup-icon-btn')).toBeFalsy();
  });

  it('does not reveal the icon on header or empty cells', async () => {
    const fixture = await render([oc({ contractID: 'a' })]);
    const el: HTMLElement = fixture.nativeElement;

    el.querySelector<HTMLElement>('.header-cell')!.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true }),
    );
    fixture.detectChanges();
    expect(el.querySelector('.popup-icon-btn')).toBeFalsy();
  });

  it('click reveals the icon (touch); focusing it opens the popup (keyboard)', async () => {
    const fixture = await render([oc({ contractID: 'a' })]);
    const el: HTMLElement = fixture.nativeElement;
    const popups = () => document.querySelectorAll('.chain-cell-popup');
    const cell = el.querySelector<HTMLElement>('[data-cid="a"]')!;

    // No pointer hover — a click still arms the icon.
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    const icon = cell.querySelector<HTMLElement>('.popup-icon-btn');
    expect(icon).toBeTruthy();

    // Tab lands on the button → focusin opens the popup.
    icon!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(popups().length).toBe(1);

    icon!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    fixture.detectChanges();
    expect(popups().length).toBe(0);
  });

  it('clears a showing icon when the model rebuilds', async () => {
    const fixture = await render([oc({ contractID: 'a' })]);
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLElement>('[data-cid="a"]')!.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true }),
    );
    fixture.detectChanges();
    expect(el.querySelector('.popup-icon-btn')).toBeTruthy();

    fixture.componentRef.setInput('model', {
      expirations: ['2026-10-16'],
      totalStrikes: 1,
      atmStrike: null,
      rows: [{ strike: 600, cells: [null] }],
    });
    fixture.detectChanges();
    expect(el.querySelector('.popup-icon-btn')).toBeFalsy();
  });
});
