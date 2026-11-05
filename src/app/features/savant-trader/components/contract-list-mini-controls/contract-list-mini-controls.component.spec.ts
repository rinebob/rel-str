/**
 * ListMiniControlsComponent specs (#1363) — the page-level chunk strip.
 * Rendered harness over the real session store: the strip exists only
 * while a session is active; every control delegates to a store method
 * and routes emitted lines through the `send` output for the page's
 * loadPlotted path.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { TradeSide } from '@common';
import { OptionType } from '@options/common';
import type { ContractListPickRow, ContractListRow } from '@options-replay/contracts';
import type { OptionsContractListUi } from '../../backtest/common/options-replay.types';
import { ContractListService } from '../../services/contract-list.service';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';
import { ListMiniControlsComponent } from './contract-list-mini-controls.component';

const pick = (i: number): ContractListPickRow => ({
  kind: 'pick',
  entryDate: `2026-06-${String(i + 1).padStart(2, '0')}`,
  contractId: `QQQ260619P${String(48000 + i).padStart(8, '0')}`,
  side: TradeSide.LONG,
  repeatsPrevious: false,
  underlyingClose: 500,
  expiration: '2026-06-19',
  dte: 9,
  strike: 500,
  delta: 0.5,
  iv: 0.2,
  mark: 5,
  bid: 4.9,
  ask: 5.1,
  volume: 100,
  openInterest: 1000,
});

/** 15 picks → 2 chunks at the default size 10 (10 + 5). */
const rows = (): ContractListRow[] => Array.from({ length: 15 }, (_, i) => pick(i));

const lineOf = (r: ContractListPickRow) => `${r.entryDate},${r.contractId}`;

const listDoc = (): OptionsContractListUi => ({
  listId: 'run-1_QQQ',
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: 'success',
  rows: rows(),
  pickDocMeta: {
    coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
    gridVersion: 1,
    pickCount: 15,
    missCount: 0,
    firstDate: '2026-06-01',
    lastDate: '2026-06-15',
  },
  generatedAtIso: '2026-06-30T15:00:00Z',
});

describe('ListMiniControlsComponent', () => {
  let store: InstanceType<typeof ContractListSessionStore>;

  const setup = (withDoc = true): void => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ContractListSessionStore,
        { provide: ContractListService, useValue: { getList$: jest.fn() } },
      ],
    });
    store = TestBed.inject(ContractListSessionStore);
    store.setSymbol('QQQ');
    if (withDoc) store.loadListDoc(listDoc());
  };

  const render = (): ComponentFixture<ListMiniControlsComponent> => {
    const fixture = TestBed.createComponent(ListMiniControlsComponent);
    fixture.detectChanges();
    return fixture;
  };

  const el = (fixture: ComponentFixture<ListMiniControlsComponent>) =>
    fixture.nativeElement as HTMLElement;
  const btn = (fixture: ComponentFixture<ListMiniControlsComponent>, label: string) =>
    el(fixture).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  beforeEach(() => localStorage.clear());

  it('renders nothing without an active session', () => {
    setup(false);
    const fixture = render();

    expect(el(fixture).querySelector('.list-mini-controls')).toBeNull();
  });

  it('renders the strip with the i/n readout once a session is active', () => {
    setup();
    const fixture = render();

    expect(el(fixture).querySelector('.list-mini-controls')).not.toBeNull();
    expect(el(fixture).querySelector('.mini-info')!.textContent).toContain('chunk 1/2');
    expect(btn(fixture, 'Previous chunk').disabled).toBe(true);
    expect(btn(fixture, 'Next chunk').disabled).toBe(false);
  });

  it('▶ steps the cursor, updates i/n, and emits the landed chunk', () => {
    setup();
    const fixture = render();
    const sent: string[][] = [];
    fixture.componentInstance.send.subscribe((l) => sent.push(l));

    btn(fixture, 'Next chunk').dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(store.chunkCursor()).toBe(1);
    expect(el(fixture).querySelector('.mini-info')!.textContent).toContain('chunk 2/2');
    expect(btn(fixture, 'Next chunk').disabled).toBe(true);
    const picks = rows() as ContractListPickRow[];
    expect(sent).toEqual([picks.slice(10).map(lineOf)]);
  });

  it('All selects every pick and emits the full set', () => {
    setup();
    store.selectNone();
    const fixture = render();
    const sent: string[][] = [];
    fixture.componentInstance.send.subscribe((l) => sent.push(l));

    const all = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.ds-btn'))
      .find((b) => b.textContent?.trim() === 'All')!;
    all.dispatchEvent(new Event('click'));

    expect(store.selection().size).toBe(15);
    const picks = rows() as ContractListPickRow[];
    expect(sent).toEqual([picks.map(lineOf)]);
  });

  it('the size select repartitions without emitting', () => {
    setup();
    const fixture = render();
    const sent: string[][] = [];
    fixture.componentInstance.send.subscribe((l) => sent.push(l));

    const sel = el(fixture).querySelector<HTMLSelectElement>('select')!;
    sel.value = '50';
    sel.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(store.chunkSize()).toBe(50);
    expect(store.chunks().length).toBe(1);
    expect(el(fixture).querySelector('.mini-info')!.textContent).toContain('chunk 1/1');
    expect(sent).toEqual([]);
  });

  it('Picker emits openPicker — the page owns the dialog ref', () => {
    setup();
    const fixture = render();
    const spy = jest.fn();
    fixture.componentInstance.openPicker.subscribe(spy);

    const picker = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.ds-btn'))
      .find((b) => b.textContent?.trim() === 'Picker')!;
    picker.dispatchEvent(new Event('click'));

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
