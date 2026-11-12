/// <reference types="jest" />
/**
 * Unit-seam specs for the page-scoped coordination services extracted
 * from OptionChartComponent (#1392). Behavior-level coverage still lives
 * in option-chart{,-list,-generator}.spec.ts (the component facade is
 * unchanged); these pin the new seams directly: the page context's
 * symbol orchestration, the catalog's builder/filter seams, and the
 * load/generator handoffs.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';

import { DsDialogService } from '../../../../shared/ds/ds-dialog';
import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import { OptionGroupGeneratorStore } from '../../stores/option-group-generator.store';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';
import { ContractListService } from '../../services/contract-list.service';
import { OptionsAnalysisRunsService } from '../../backtest/services/options-analysis-runs.service';
import { EXIT_REGISTRY_VERSION } from '@options-analysis/registry';
import { OptionsContractService } from '../../services/options-contract.service';
import { ContractAvailabilityService } from '../../services/contract-availability.service';
import { OptionsReplayRunsService } from '../../backtest/services/options-replay-runs.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import { TradeSide } from '@common';
import { OptionType } from '@options/common';
import type { ContractListPickRow, ContractListRow } from '@options-replay/contracts';
import type { OptionsContractListUi } from '../../backtest/common/options-replay.types';
import { OPTION_CHART_PAGE_PROVIDERS } from './option-chart-page.providers';
import { OptionChartPageService } from './option-chart-page.service';
import { OptionChartCatalogService } from './option-chart-catalog.service';
import { OptionChartLoadService } from './option-chart-load.service';
import { OptionChartListService } from './option-chart-list.service';
import { OptionChartReplayService } from './option-chart-replay.service';
import { OptionChartGeneratorService } from './option-chart-generator.service';
import { ContractListPickerComponent } from '../../components/contract-list-picker/contract-list-picker.component';

const pickRow = (entryDate: string, contractId: string): ContractListPickRow => ({
  kind: 'pick',
  entryDate,
  contractId,
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

const listDoc = (over: Partial<OptionsContractListUi> = {}): OptionsContractListUi => ({
  listId: 'svc-doc',
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: 'success',
  rows: [pickRow('2026-06-10', 'QQQ260619P00470000')] as ContractListRow[],
  pickDocMeta: {
    coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
    gridVersion: 1,
    pickCount: 1,
    missCount: 0,
    firstDate: '2026-06-10',
    lastDate: '2026-06-10',
  },
  generatedAtIso: '2026-06-16T10:00:00Z',
  ...over,
});

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      ...OPTION_CHART_PAGE_PROVIDERS,
      {
        provide: OptionsContractService,
        useValue: {
          getHistoricalOptionsContract$: jest.fn(),
          getContractIndex$: jest.fn(() => of({ expirations: [], strikes: [] })),
          getContractCatalogSummary$: jest.fn(() => of(null)),
          queryContractCatalog$: jest.fn(() => of({ contracts: [], count: 0 })),
        },
      },
      { provide: ContractAvailabilityService, useValue: { queryContractAvailability$: jest.fn() } },
      { provide: ContractListService, useValue: { getList$: jest.fn(() => of(null)), recentLists$: jest.fn(() => of([])) } },
      { provide: OptionsAnalysisRunsService, useValue: { getResultDoc$: jest.fn(() => of(null)) } },
      { provide: OptionsReplayRunsService, useValue: { watchRuns: jest.fn(() => of([])), watchContractList: jest.fn(() => of(null)) } },
      { provide: LocalBarReadService, useValue: { getDailyBarsForRange$: jest.fn(() => of([])) } },
      { provide: DsDialogService, useValue: { open: jest.fn(() => ({ afterClosed: () => of(undefined) })), openDialogs: [] } },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
      { provide: Router, useValue: { navigate: jest.fn() } },
    ],
  });
  return {
    page: TestBed.inject(OptionChartPageService),
    catalog: TestBed.inject(OptionChartCatalogService),
    load: TestBed.inject(OptionChartLoadService),
    list: TestBed.inject(OptionChartListService),
    replay: TestBed.inject(OptionChartReplayService),
    gen: TestBed.inject(OptionChartGeneratorService),
    store: TestBed.inject(OptionsContractViewerStore),
    genStore: TestBed.inject(OptionGroupGeneratorStore),
    listStore: TestBed.inject(ContractListSessionStore),
  };
}

describe('OptionChartPageService — symbol switch orchestration', () => {
  beforeEach(() => localStorage.clear());

  it('swaps the symbol, clears the input + list error, and reloads symbol data', () => {
    const { page, store, genStore, listStore } = setup();
    page.occIdInput = 'QQQ260619P00470000';
    page.listError.set('stale error');
    const index = jest.spyOn(store, 'loadContractIndex');
    const summary = jest.spyOn(store, 'loadCatalogSummary');
    const bars = jest.spyOn(store, 'loadUnderlyingBars');

    page.onSymbolChange('SPY');

    expect(page.symbol()).toBe('SPY');
    expect(page.occIdInput).toBe('');
    expect(page.listError()).toBeNull();
    expect(index).toHaveBeenCalledWith('SPY');
    expect(summary).toHaveBeenCalledWith('SPY');
    expect(bars).toHaveBeenCalledWith('SPY');
    // gen/list stores swap their per-symbol blobs — both expose symbol().
    expect(genStore.symbol()).toBe('SPY');
    expect(listStore.symbol()).toBe('SPY');
  });

  it('fires onSymbolSwitched — the hook every swap path clears swap-scoped state through (#1423)', () => {
    const { page } = setup();
    const switched = jest.fn();
    page.onSymbolSwitched = switched;

    page.onSymbolChange('SPY');
    expect(switched).toHaveBeenCalledTimes(1);
  });

  it('drops the plotted set — contracts, hover, and pin — on symbol swap (#1440)', async () => {
    const { page, store } = setup();
    (TestBed.inject(OptionsContractService).getHistoricalOptionsContract$ as jest.Mock)
      .mockReturnValue(of({ daily: [] }));
    await store.loadPlotted([
      {
        contractId: 'QQQ260619P00470000',
        openDate: '2026-06-10',
        markerDates: ['2026-06-10'],
      },
    ]);
    store.setHoveredContract('QQQ260619P00470000');
    store.togglePinnedContract('QQQ260619P00470000');
    expect(Object.keys(store.plottedContracts())).toHaveLength(1);

    page.onSymbolChange('SPY');

    expect(store.plottedContracts()).toEqual({});
    expect(store.hoveredContractId()).toBeNull();
    expect(store.pinnedContractId()).toBeNull();
    expect(store.chartFocusContractId()).toBeNull();
  });

  it('drops a focused single contract on symbol swap (#1440)', async () => {
    const { page, store, load } = setup();
    (TestBed.inject(OptionsContractService).getHistoricalOptionsContract$ as jest.Mock)
      .mockReturnValue(of({ daily: [] }));
    page.occIdInput = 'QQQ261218P00645000';

    await load.onLoad();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.chartFocusContractId()).toBe('QQQ261218P00645000');

    page.onSymbolChange('SPY');

    // Focus null alone isn't enough — the series projection renders
    // contractData whenever the set is empty, so the data itself must go.
    expect(store.chartFocusContractId()).toBeNull();
    expect(store.contractData()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.occIdInput()).toBe('');
  });

  it('a contract load resolving after a swap is dropped — no stale contract, no underlying yank-back (#1440)', async () => {
    const { page, store } = setup();
    const svc = TestBed.inject(OptionsContractService);
    const pending = new Subject<unknown>();
    (svc.getHistoricalOptionsContract$ as jest.Mock).mockReturnValue(pending.asObservable());
    const rangeBars = jest.spyOn(store, 'loadUnderlyingBarsForRange');

    store.loadContract('QQQ261218P00645000', null);
    expect(store.chartFocusContractId()).toBe('QQQ261218P00645000');

    page.onSymbolChange('SPY'); // swap mid-flight — releases focus + plotted state
    pending.next({ daily: [], symbol: 'QQQ', startDate: '2026-01-01', endDate: '2026-02-01' });
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(store.contractData()).toBeNull();
    expect(store.chartFocusContractId()).toBeNull();
    // The dropped response must not strand the loading spinner either.
    expect(store.loading()).toBe(false);
    // The stale response must not refetch the OLD symbol's underlying —
    // and no swap-path code calls the ForRange seam, so "never called" is
    // the real pin (a per-arg matcher would pass vacuously on arity).
    expect(rangeBars).not.toHaveBeenCalled();
  });

  it('a contract load erroring after a swap is dropped — no stale error under the new symbol (#1440)', async () => {
    const { page, store } = setup();
    const svc = TestBed.inject(OptionsContractService);
    const pending = new Subject<unknown>();
    (svc.getHistoricalOptionsContract$ as jest.Mock).mockReturnValue(pending.asObservable());

    store.loadContract('QQQ261218P00645000', null);
    page.onSymbolChange('SPY');
    pending.error(new Error('upstream 500'));
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(store.error()).toBeNull();
    expect(store.loading()).toBe(false);
  });

  it('a superseded same-contract load cannot kill the newer one — stale error then fresh success (#1440)', async () => {
    const { store } = setup();
    const svc = TestBed.inject(OptionsContractService);
    const first = new Subject<unknown>();
    const second = new Subject<unknown>();
    (svc.getHistoricalOptionsContract$ as jest.Mock)
      .mockReturnValueOnce(first.asObservable())
      .mockReturnValueOnce(second.asObservable());

    // Same-id double-load — the contract id can't discriminate the two
    // requests, the load seq does: the FIRST load's error must not
    // release focus or the spinner the second load owns.
    store.loadContract('QQQ261218P00645000', null);
    store.loadContract('QQQ261218P00645000', null);
    first.error(new Error('transient'));
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(store.error()).toBeNull();
    expect(store.loading()).toBe(true);
    expect(store.chartFocusContractId()).toBe('QQQ261218P00645000');

    second.next({ daily: [], symbol: 'QQQ', startDate: '2026-01-01', endDate: '2026-02-01' });
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.contractData()).not.toBeNull();
    expect(store.loading()).toBe(false);
  });

  it('a focus-released mid-flight load still completes — back-to-set during fetch (#1440)', async () => {
    const { store } = setup();
    const svc = TestBed.inject(OptionsContractService);
    const pending = new Subject<unknown>();
    (svc.getHistoricalOptionsContract$ as jest.Mock).mockReturnValue(pending.asObservable());

    store.loadContract('QQQ261218P00645000', null);
    store.clearChartFocus(); // back to the set while the fetch is in flight
    pending.next({ daily: [], symbol: 'QQQ', startDate: '2026-01-01', endDate: '2026-02-01' });
    await new Promise<void>((r) => setTimeout(r, 0));

    // The release is a view change, not a cancellation — the load lands
    // and the spinner can't strand.
    expect(store.contractData()).not.toBeNull();
    expect(store.loading()).toBe(false);
  });

  it('an underlying fetch resolving after a swap is dropped — no foreign bars (#1440)', async () => {
    const { page, store } = setup();
    const lbr = TestBed.inject(LocalBarReadService);
    const qqq = new Subject<unknown[]>();
    const spyBars = new Subject<unknown[]>();
    (lbr.getDailyBarsForRange$ as jest.Mock)
      .mockImplementation((sym: string) => (sym === 'QQQ' ? qqq : spyBars).asObservable());

    store.loadUnderlyingBars('QQQ'); // old session's fetch in flight
    page.onSymbolChange('SPY');      // swap issues the SPY fetch

    spyBars.next([]);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.underlyingBarsRange()?.symbol).toBe('SPY');

    // The slow QQQ response lands last — latest-request-wins drops it.
    qqq.next([]);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.underlyingBarsRange()?.symbol).toBe('SPY');
  });

  it('initSession clears a previous session — the root store survives page teardown (#1440)', async () => {
    const { page, store } = setup();
    (TestBed.inject(OptionsContractService).getHistoricalOptionsContract$ as jest.Mock)
      .mockReturnValue(of({ daily: [] }));
    await store.loadPlotted([
      { contractId: 'QQQ260619P00470000', openDate: '2026-06-10', markerDates: ['2026-06-10'] },
    ]);
    expect(Object.keys(store.plottedContracts())).toHaveLength(1);

    page.initSession();

    expect(store.plottedContracts()).toEqual({});
    expect(store.contractData()).toBeNull();
    // initSession refetches for the session symbol — the range describes
    // the fresh request, not the stale session's.
    expect(store.underlyingBarsRange()?.symbol).toBe('QQQ');
  });

  it('a loadPlotted worker resolving after a swap cannot resurrect the contract (#1440)', async () => {
    const { page, store } = setup();
    const svc = TestBed.inject(OptionsContractService);
    const pending = new Subject<unknown>();
    (svc.getHistoricalOptionsContract$ as jest.Mock).mockReturnValue(pending.asObservable());

    void store.loadPlotted([
      { contractId: 'QQQ260619P00470000', openDate: '2026-06-10' },
    ]);
    page.onSymbolChange('SPY');
    pending.next({ daily: [] });
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(store.plottedContracts()).toEqual({});
  });

  it('a >50 confirm pending across a swap drops the stale parsed set (#1440)', async () => {
    const { page, load, store } = setup();
    const dialog = TestBed.inject(DsDialogService) as unknown as { open: jest.Mock };
    const pending = new Subject<boolean>();
    dialog.open.mockReturnValue({ afterClosed: () => pending.asObservable() });
    const loadPlotted = jest.spyOn(store, 'loadPlotted').mockResolvedValue(undefined);
    const lines = Array.from(
      { length: 51 },
      (_, i) => `2026-06-10,QQQ260619P0047${String(i).padStart(3, '0')}0`,
    );

    void load.onLoad(lines.join('\n')); // >50 — confirm opens, await pending
    page.onSymbolChange('SPY');         // swap while the confirm is open
    pending.next(true);
    await new Promise<void>((r) => setTimeout(r, 0));

    // The entries were parsed as QQQ — loading them under SPY would be
    // the foreign-symbol overlay this bug fixes.
    expect(loadPlotted).not.toHaveBeenCalled();
  });

  it('initSession seeds the catalog builder and swaps store symbols', () => {
    const { page, store, genStore, listStore } = setup();
    page.type.set('call');
    const builder = jest.spyOn(store, 'setCatalogBuilder');

    page.initSession();

    expect(builder).toHaveBeenCalledWith({ symbol: 'QQQ', type: 'C' });
    expect(genStore.symbol()).toBe('QQQ');
    expect(listStore.symbol()).toBe('QQQ');
  });
});

describe('OptionChartCatalogService — builder + chart filter', () => {
  beforeEach(() => localStorage.clear());

  it('builtOccId is empty for type=both and a real OCC id for a call', () => {
    const { page, catalog, store } = setup();
    store.setExpiration('2026-06-19');
    store.setStrike(470);

    expect(catalog.builtOccId()).toBe('');

    page.type.set('call');
    expect(catalog.builtOccId()).toBe('QQQ260619C00470000');
  });

  it('onFilterToChart is a no-op without chart extents and applies them when bound', () => {
    const { page, catalog, store } = setup();
    const filters = jest.spyOn(store, 'setCatalogFilters');

    catalog.onFilterToChart(); // no hook — nothing happens
    expect(filters).not.toHaveBeenCalled();

    page.chartExtents = () => ({
      startDate: '2026-01-05',
      endDate: '2026-03-20',
      priceLow: 440.4,
      priceHigh: 470.6,
    });
    catalog.onFilterToChart();

    expect(catalog.expMin()).toBe('2026-01-05');
    expect(catalog.strikeMin()).toBe(440);
    expect(catalog.strikeMax()).toBe(471);
    expect(filters).toHaveBeenCalledWith(
      expect.objectContaining({ expirationGte: '2026-01-05', expirationLte: '2026-03-20' }),
    );
  });
});

describe('OptionChartLoadService — emit seam', () => {
  beforeEach(() => localStorage.clear());

  it('rejectionReasonLabel names the page symbol for wrong-underlying', () => {
    const { page, load } = setup();
    expect(load.rejectionReasonLabel('wrong-underlying')).toBe('not a QQQ contract');
    page.symbol.set('SPY');
    expect(load.rejectionReasonLabel('wrong-underlying')).toBe('not a SPY contract');
  });

  it('a send while the >50 confirm is pending drops — no stacked dialog, no queued load', async () => {
    const { load, store } = setup();
    const dialog = TestBed.inject(DsDialogService) as unknown as { open: jest.Mock };
    const pending = new Subject<boolean>();
    dialog.open.mockReturnValue({ afterClosed: () => pending.asObservable() });
    const loadPlotted = jest.spyOn(store, 'loadPlotted').mockResolvedValue(undefined);
    const lines = Array.from(
      { length: 51 },
      (_, i) => `2026-06-10,QQQ260619P0047${String(i).padStart(3, '0')}0`,
    );

    load.emitLinesToChart(lines); // opens the >50 confirm and awaits it
    load.emitLinesToChart(lines); // dropped — confirm still pending

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(loadPlotted).not.toHaveBeenCalled();

    pending.next(true);
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(loadPlotted).toHaveBeenCalledTimes(1);
    expect(loadPlotted.mock.calls[0][0]).toHaveLength(51);
  });
});

describe('OptionChartLoadService — auto-swap on foreign underlying', () => {
  beforeEach(() => localStorage.clear());

  it('a foreign-symbol paste swaps the page to that underlying and loads under it', async () => {
    const { page, load, store } = setup();
    const loadPlotted = jest.spyOn(store, 'loadPlotted').mockResolvedValue(undefined);

    await load.onLoad('2026-06-10,SPY260619P00470000');

    expect(page.symbol()).toBe('SPY');
    expect(loadPlotted).toHaveBeenCalledWith([
      expect.objectContaining({ contractId: 'SPY260619P00470000', openDate: '2026-06-10' }),
    ]);
    // The swap clears the field — the pasted text is restored so the
    // field keeps matching the plotted set.
    expect(page.occIdInput).toBe('2026-06-10,SPY260619P00470000');
    expect(load.rejectedEntries()).toEqual([]);
  });

  it('a bare foreign-symbol id swaps then focused-loads', async () => {
    const { page, load, store } = setup();
    (TestBed.inject(OptionsContractService).getHistoricalOptionsContract$ as jest.Mock)
      .mockReturnValue(of({ daily: [] }));
    const loadContract = jest.spyOn(store, 'loadContract');

    await load.onLoad('SPY261218P00645000');

    expect(page.symbol()).toBe('SPY');
    expect(loadContract).toHaveBeenCalledWith('SPY261218P00645000', null);
  });

  it('mixed underlyings swap to the majority and wrong-underlying-reject the rest', async () => {
    const { page, load, store } = setup();
    const loadPlotted = jest.spyOn(store, 'loadPlotted').mockResolvedValue(undefined);

    await load.onLoad(
      [
        '2026-06-10,SPY260619P00470000',
        '2026-06-10,SPY260619P00480000',
        '2026-06-10,QQQ260619P00470000',
      ].join('\n'),
    );

    expect(page.symbol()).toBe('SPY');
    expect(loadPlotted).toHaveBeenCalledWith([
      expect.objectContaining({ contractId: 'SPY260619P00470000' }),
      expect.objectContaining({ contractId: 'SPY260619P00480000' }),
    ]);
    expect(load.rejectedEntries()).toEqual([
      { raw: 'QQQ260619P00470000', reason: 'wrong-underlying' },
    ]);
    // The label resolves against the post-swap symbol.
    expect(load.rejectionReasonLabel('wrong-underlying')).toBe('not a SPY contract');
  });

  it('a same-symbol load never fires the swap path', async () => {
    const { page, load, store } = setup();
    const loadPlotted = jest.spyOn(store, 'loadPlotted').mockResolvedValue(undefined);
    const switched = jest.fn();
    page.onSymbolSwitched = switched;

    await load.onLoad('2026-06-10,QQQ260619P00470000');

    expect(page.symbol()).toBe('QQQ');
    expect(switched).not.toHaveBeenCalled();
    expect(loadPlotted).toHaveBeenCalled();
  });
});

describe('OptionChartReplayService — runs dropdown', () => {
  beforeEach(() => localStorage.clear());

  it('a dead runs stream surfaces a named error instead of failing silently', () => {
    const { replay } = setup();
    (TestBed.inject(OptionsReplayRunsService).watchRuns as jest.Mock)
      .mockReturnValue(throwError(() => new Error('dead stream')));

    replay.bindRuns();

    expect(replay.replayError()).toBe('Could not load replay runs');
    expect(replay.replayRuns()).toEqual([]);
  });

  it('a picked run syncs the list session — the picker opens with the plotted rows checked (#1423)', async () => {
    const { replay, listStore, load, page } = setup();
    // Session precondition — initSession would setSymbol; mirror it so a
    // doc for the same symbol isn't rejected as foreign.
    listStore.setSymbol('QQQ');
    jest.spyOn(load, 'onLoad').mockResolvedValue();

    // 12 Wednesday picks (06-10 is a Wednesday, +7 days stays on it —
    // Date arithmetic so month boundaries can't produce 06-31) + a
    // Monday pick — the slice is the first 10 Wednesdays only.
    const wed = (i: number) =>
      new Date(Date.UTC(2026, 5, 10 + i * 7)).toISOString().slice(0, 10);
    const rows: ContractListRow[] = [
      pickRow('2026-06-08', 'QQQ260619P00400000'),
      ...Array.from({ length: 12 }, (_, i) =>
        pickRow(wed(i), `QQQ260619P004${String(70 + i)}000`),
      ),
    ];
    (TestBed.inject(OptionsReplayRunsService).watchContractList as jest.Mock)
      .mockReturnValue(of(listDoc({ rows })));

    await replay.onReplaySelected('run-1');

    expect(listStore.status()).toBe('ready');
    expect(listStore.activeList()?.listId).toBe('svc-doc');
    expect(listStore.selectedRows().length).toBe(10);
    // Only Wednesday dates — the Monday pick and the 2 over-cap rows are out.
    for (const r of listStore.selectedRows()) {
      expect(new Date(`${r.entryDate}T00:00:00Z`).getUTCDay()).toBe(3);
    }
    expect(listStore.selectedRows().map((r) => r.contractId)).toContain('QQQ260619P00470000');
    expect(listStore.selectedRows().map((r) => r.contractId)).not.toContain('QQQ260619P00400000');
    // The textarea still carries the same 10 plotted lines.
    expect(page.occIdInput.trim().split('\n')).toHaveLength(10);
  });
});

describe('OptionChartListService / OptionChartGeneratorService — page scoping', () => {
  beforeEach(() => localStorage.clear());

  it('a doc applied through the list service lands on the shared session store', () => {
    const { list, listStore } = setup();
    // Instance identity — the AC's page-scoping pin: the store the
    // service writes IS the one TestBed (and the picker dialog, via the
    // element injector) resolves, so the doc lands on the shared session.
    // initSession normally sets the session symbol first — mirror that
    // precondition so the doc isn't rejected as a foreign symbol.
    listStore.setSymbol('QQQ');
    const apply = jest.spyOn(listStore, 'loadListDoc');
    const doc = listDoc();

    list.onContractListDoc(doc);

    expect(apply).toHaveBeenCalledWith(doc);
    expect(listStore.status()).toBe('ready');
    expect(listStore.activeList()?.listId).toBe('svc-doc');
  });

  it('clearStudyRange clears the alive-range bound and disarms the brush', () => {
    const { gen, genStore } = setup();
    gen.brushArmed.set(true);
    const applyRange = jest.spyOn(genStore, 'applyRange');

    gen.clearStudyRange();

    expect(applyRange).toHaveBeenCalledWith(null);
    expect(gen.brushArmed()).toBe(false);
  });
});

// #1431 item 12 — ?results= deep link: result doc → plotted entries.
describe('OptionChartListService — analysis-results deep link', () => {
  beforeEach(() => localStorage.clear());

  const resultDoc = (over: Record<string, unknown> = {}) => ({
    contractListDocId: 'run-1_SPY',
    runId: 'run-1',
    symbol: 'QQQ',
    templateId: 'csp-45-20',
    exitId: 'target-90',
    registryVersion: EXIT_REGISTRY_VERSION,
    status: 'success',
    trades: [
      {
        runId: 'run-1',
        symbol: 'QQQ',
        templateId: 'csp-45-20',
        contractListDocId: 'run-1_SPY',
        exitId: 'target-90',
        pickDate: '2026-06-10',
        contractId: 'QQQ260619P00470000',
        entryMark: 2.5,
        daysHeld: 9,
        mae: { value: 1.2, date: '2026-06-12' },
        mfe: { value: 3.1, date: '2026-06-18' },
        outcome: 'exit',
        exitDate: '2026-06-19',
        exitPrice: 0.25,
      },
    ],
    aggregate: {
      exitId: 'target-90',
      contractCount: 1,
      exitedCount: 1,
      expiredCount: 0,
      openCount: 0,
      errorCount: 0,
    },
    generatedAt: '2026-11-10T00:00:00Z',
    ...over,
  });

  it('a success doc emits its contracts with pick + exit markers', async () => {
    const { list, load } = setup();
    (TestBed.inject(OptionsAnalysisRunsService).getResultDoc$ as jest.Mock)
      .mockReturnValue(of(resultDoc()));
    const emit = jest.spyOn(load, 'emitEntriesToChart').mockImplementation(() => {});

    await list.onResultsDocId('run-1_SPY_target-90');

    expect(emit).toHaveBeenCalledWith([
      {
        contractId: 'QQQ260619P00470000',
        openDate: '2026-06-10',
        markerDates: ['2026-06-10', '2026-06-19'],
      },
    ]);
    expect(list.listErrorText()).toBeNull();
  });

  it('a missing doc names its error and emits nothing', async () => {
    const { list, load } = setup();
    (TestBed.inject(OptionsAnalysisRunsService).getResultDoc$ as jest.Mock)
      .mockReturnValue(of(null));
    const emit = jest.spyOn(load, 'emitEntriesToChart').mockImplementation(() => {});

    await list.onResultsDocId('run-1_SPY_target-90');

    expect(list.listErrorText()).toContain('not found');
    expect(emit).not.toHaveBeenCalled();
  });

  it('a failed doc names its status and emits nothing', async () => {
    const { list, load } = setup();
    (TestBed.inject(OptionsAnalysisRunsService).getResultDoc$ as jest.Mock)
      .mockReturnValue(of(resultDoc({ status: 'failed' })));
    const emit = jest.spyOn(load, 'emitEntriesToChart').mockImplementation(() => {});

    await list.onResultsDocId('run-1_SPY_target-90');

    expect(list.listErrorText()).toContain("status 'failed'");
    expect(emit).not.toHaveBeenCalled();
  });

  it('a fetch error names the failure and emits nothing', async () => {
    const { list, load } = setup();
    (TestBed.inject(OptionsAnalysisRunsService).getResultDoc$ as jest.Mock)
      .mockReturnValue(throwError(() => new Error('permission-denied')));
    const emit = jest.spyOn(load, 'emitEntriesToChart').mockImplementation(() => {});

    await list.onResultsDocId('run-1_SPY_target-90');

    expect(list.listErrorText()).toContain('failed to load');
    expect(list.listErrorText()).toContain('permission-denied');
    expect(emit).not.toHaveBeenCalled();
  });

  it('a doc with no contract records names it instead of emitting an empty set', async () => {
    const { list, load } = setup();
    (TestBed.inject(OptionsAnalysisRunsService).getResultDoc$ as jest.Mock)
      .mockReturnValue(of(resultDoc({ trades: [] })));
    const emit = jest.spyOn(load, 'emitEntriesToChart').mockImplementation(() => {});

    await list.onResultsDocId('run-1_SPY_target-90');

    expect(list.listErrorText()).toContain('no contract records');
    expect(emit).not.toHaveBeenCalled();
  });
});
