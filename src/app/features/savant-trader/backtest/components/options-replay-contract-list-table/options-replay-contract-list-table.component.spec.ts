import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OptionsReplayContractListTableComponent } from './options-replay-contract-list-table.component';
import { TradeSide } from '@common';
import { OptionType } from '@options/common';
import type { ContractListPickRow } from '@options-replay/contracts';
import type { ContractListRow, PickDocMeta } from '../../common/options-replay.types';

function makePick(overrides: Partial<ContractListPickRow> = {}): ContractListPickRow {
  return {
    kind: 'pick',
    entryDate: '2026-01-05',
    contractId: 'SPY260220P00550000',
    side: TradeSide.SHORT,
    expiration: '2026-02-20',
    dte: 46,
    strike: 550,
    delta: -0.21,
    iv: 0.19,
    mark: 4.85,
    bid: 4.8,
    ask: 4.9,
    volume: 1200,
    openInterest: 5400,
    underlyingClose: 598.12,
    repeatsPrevious: false,
    ...overrides,
  };
}

function makeMeta(overrides: Partial<PickDocMeta> = {}): PickDocMeta {
  return {
    coordinate: {
      type: OptionType.PUT,
      targetDelta: -0.2,
      expiry: { mode: 'nearestDte', dte: 45 },
    },
    gridVersion: 3,
    pickCount: 8,
    missCount: 2,
    firstDate: '2026-01-02',
    lastDate: '2026-01-13',
    ...overrides,
  };
}

describe('OptionsReplayContractListTableComponent', () => {
  async function setup(rows: ContractListRow[] = [makePick()], meta: PickDocMeta | undefined = undefined) {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionsReplayContractListTableComponent);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('pickDocMeta', meta);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a pick row with all columns', async () => {
    const fixture = await setup();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('2026-01-05');
    expect(text).toContain('SPY260220P00550000');
    expect(text).toContain('STO');
    expect(text).toContain('2026-02-20 (46)');
    expect(text).toContain('550.00');
    expect(text).toContain('4.85');
    expect(text).toContain('4.80 / 4.90');
    expect(text).toContain('598.12');
  });

  it('renders a no-selection marker row in place', async () => {
    const fixture = await setup([
      makePick({ entryDate: '2026-01-02' }),
      { kind: 'no-selection', entryDate: '2026-01-03', reason: 'gap' },
    ]);
    const marker = fixture.nativeElement.querySelector('.marker-row .marker-cell');
    expect(marker.textContent).toContain('no selection');
    expect(marker.textContent).toContain('data gap');
  });

  it('labels repeatsPrevious rows with a repeat badge — each stays its own row', async () => {
    const fixture = await setup([
      makePick({ entryDate: '2026-01-02' }),
      makePick({ entryDate: '2026-01-05', repeatsPrevious: true }),
    ]);
    const rows = fixture.nativeElement.querySelectorAll('.pick-row');
    expect(rows.length).toBe(2);
    expect(rows[1].querySelector('.repeat-badge').textContent).toContain('repeat');
    expect(rows[0].querySelector('.repeat-badge')).toBeNull();
  });

  it('sorts rows by entryDate regardless of input order', async () => {
    const fixture = await setup([
      makePick({ entryDate: '2026-01-07' }),
      makePick({ entryDate: '2026-01-02' }),
    ]);
    const dates = [...fixture.nativeElement.querySelectorAll('.entry-date')].map(
      (el: Element) => el.textContent.trim()
    );
    expect(dates).toEqual(['2026-01-02', '2026-01-07']);
  });

  it('renders the coverage header from pickDocMeta', async () => {
    const fixture = await setup([makePick()], makeMeta());
    const header = fixture.nativeElement.querySelector('.coverage-header');
    expect(header.textContent).toContain('8 picks');
    expect(header.textContent).toContain('2 misses');
    expect(header.textContent).toContain('2026-01-02');
    expect(header.textContent).toContain('2026-01-13');
    expect(header.textContent).toContain('grid v3');
  });

  it('omits the coverage header when pickDocMeta is absent', async () => {
    const fixture = await setup([makePick()], undefined);
    expect(fixture.nativeElement.querySelector('.coverage-header')).toBeNull();
  });

  it('emits the pick row on inspect; marker rows have no action', async () => {
    const fixture = await setup([
      makePick({ entryDate: '2026-01-02' }),
      { kind: 'no-selection', entryDate: '2026-01-03', reason: 'miss' },
    ]);
    const emitted: ContractListPickRow[] = [];
    fixture.componentInstance.inspect.subscribe((r: ContractListPickRow) => emitted.push(r));

    const buttons = fixture.nativeElement.querySelectorAll('.inspect-button');
    expect(buttons.length).toBe(1);
    buttons[0].click();
    expect(emitted.length).toBe(1);
    expect(emitted[0].contractId).toBe('SPY260220P00550000');
  });

  it('maps side to STO for short and BTO for long', async () => {
    const fixture = await setup([
      makePick({ entryDate: '2026-01-02', side: TradeSide.SHORT }),
      makePick({ entryDate: '2026-01-03', side: TradeSide.LONG }),
    ]);
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('STO');
    expect(text).toContain('BTO');
  });
});
