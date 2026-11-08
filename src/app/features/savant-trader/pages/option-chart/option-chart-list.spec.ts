/// <reference types="jest" />
/**
 * Page ↔ contract-list session wiring specs for OptionChartComponent
 * (#1361). Same no-render posture as the generator wiring spec — the
 * component is instantiated, not rendered; specs exercise the ?list=
 * nav handler, the chooser entry point, the session→textarea send, and
 * symbol-switch session swaps with the real session store and mocked
 * services.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { DsDialogService } from '../../../../shared/ds/ds-dialog';
import { BehaviorSubject, from, of, Subject, type Observable } from 'rxjs';

import { TradeSide } from '@common';
import { OptionType } from '@options/common';
import type { ContractListPickRow, ContractListRow } from '@options-replay/contracts';
import type { OptionsContractListUi } from '../../backtest/common/options-replay.types';
import { OptionChartComponent } from './option-chart.component';
import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import { OptionGroupGeneratorStore } from '../../stores/option-group-generator.store';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';
import { ContractListService } from '../../services/contract-list.service';
import { ContractListChooserComponent } from '../../components/contract-list-chooser/contract-list-chooser.component';
import { ContractListPickerComponent } from '../../components/contract-list-picker/contract-list-picker.component';
import { ConfirmDialogComponent } from '../../../../shared/ds/confirm-dialog.component';
import { OptionsContractService } from '../../services/options-contract.service';
import { ContractAvailabilityService } from '../../services/contract-availability.service';
import { OptionsReplayRunsService } from '../../backtest/services/options-replay-runs.service';
import { LIST_SESSION_VERSION, saveListSession } from '../../utils/contract-list-session-settings';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import type { PartnerHistoricalOptionsContractV2Response } from '../../../../core/models/partner.types';

const QQQ_PUT = 'QQQ260619P00470000';

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
  listId: 'run-1_QQQ',
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: 'success',
  rows: [pickRow('2026-06-10', QQQ_PUT)] as ContractListRow[],
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

function contractResponse(contractID: string): PartnerHistoricalOptionsContractV2Response {
  return {
    ok: true,
    symbol: 'QQQ',
    contractID,
    expiration: '2026-06-19',
    type: 'put',
    strike: '470.00',
    startDate: '2026-06-01',
    endDate: '2026-06-10',
    series: [{ date: '2026-06-01', mark: '1.23' }, { date: '2026-06-10', mark: '1.30' }],
  };
}

interface Setup {
  store: InstanceType<typeof OptionsContractViewerStore>;
  listStore: InstanceType<typeof ContractListSessionStore>;
  component: OptionChartComponent;
  getList$: jest.Mock;
  dialog: { open: jest.Mock; closeAll: jest.Mock; openDialogs: unknown[] };
  params$: BehaviorSubject<ParamMap>;
}

interface MockDialogRef {
  afterClosed(): Observable<unknown>;
  close(result?: unknown): void;
}

function setup(): Setup {
  const getList$ = jest.fn();
  // The mock models DsDialogService faithfully: refs enter openDialogs on
  // open; afterClosed emits once when close() runs and the ref leaves
  // openDialogs. An open dialog must NOT block onLoad (sends can arrive
  // while a dialog is still registered open); closeAll mirrors the
  // service's close-everything.
  const dialog = {
    open: jest.fn((): MockDialogRef => {
      const closed$ = new Subject<unknown>();
      const ref: MockDialogRef = {
        afterClosed: () => closed$.asObservable(),
        close: () => {
          const i = dialog.openDialogs.indexOf(ref);
          if (i >= 0) dialog.openDialogs.splice(i, 1);
          closed$.next(undefined);
          closed$.complete();
        },
      };
      dialog.openDialogs.push(ref);
      return ref;
    }),
    closeAll: jest.fn(() => {
      for (const ref of [...dialog.openDialogs]) (ref as MockDialogRef).close();
    }),
    openDialogs: [] as unknown[],
  };
  const params$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      OptionGroupGeneratorStore,
      ContractListSessionStore,
      {
        provide: OptionsContractService,
        useValue: {
          getHistoricalOptionsContract$: jest.fn((_s: string, cid: string) => of(contractResponse(cid))),
          getContractIndex$: jest.fn(() => of({ expirations: [], strikes: [] })),
          getContractCatalogSummary$: jest.fn(() => of(null)),
        },
      },
      { provide: ContractAvailabilityService, useValue: { queryContractAvailability$: jest.fn() } },
      { provide: ContractListService, useValue: { getList$, recentLists$: jest.fn(() => of([])) } },
      {
        provide: OptionsReplayRunsService,
        useValue: { watchRuns: jest.fn(() => of([])), watchContractLists: jest.fn(() => of([])) },
      },
      { provide: LocalBarReadService, useValue: { getDailyBarsForRange$: jest.fn(() => of([])) } },
      { provide: DsDialogService, useValue: dialog },
      { provide: ActivatedRoute, useValue: { queryParamMap: params$.asObservable(), snapshot: { queryParamMap: params$.value } } },
      { provide: Router, useValue: { navigate: jest.fn() } },
    ],
  });

  return {
    store: TestBed.inject(OptionsContractViewerStore),
    listStore: TestBed.inject(ContractListSessionStore),
    component: TestBed.runInInjectionContext(() => new OptionChartComponent()),
    getList$,
    dialog,
    params$,
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe('OptionChartComponent — contract-list session wiring', () => {
  beforeEach(() => localStorage.clear());

  it('?list= loads the doc, activates the session, and opens the picker', async () => {
    const { component, listStore, getList$, dialog, params$ } = setup();
    getList$.mockReturnValue(of(listDoc()));
    component.ngOnInit();

    params$.next(convertToParamMap({ list: 'run-1_QQQ' }));
    await flush();
    await flush();

    // One read total — the page hands the doc to loadListDoc; the store
    // must not refetch it.
    expect(getList$).toHaveBeenCalledTimes(1);
    expect(getList$).toHaveBeenCalledWith('run-1_QQQ');
    expect(listStore.status()).toBe('ready');
    // The picker resolves the page-scoped session store — the dialog must
    // open on the page's element injector or inject() hits NG0201.
    expect(dialog.open).toHaveBeenCalledWith(
      ContractListPickerComponent,
      expect.objectContaining({ injector: expect.anything() }),
    );
  });

  it('?list= is consumed once and cleared from the URL', async () => {
    const { component, getList$, params$ } = setup();
    const router = TestBed.inject(Router) as unknown as { navigate: jest.Mock };
    getList$.mockReturnValue(of(listDoc()));
    component.ngOnInit();

    params$.next(convertToParamMap({ list: 'run-1_QQQ' }));
    await flush();

    // Consumed deep links must not linger — a stale param would re-fire
    // the handler (and reopen the picker) on every refresh. replaceUrl
    // keeps the consumed URL out of history.
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { list: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );
    // The cleared-param emission ('' via distinctUntilChanged) must be a no-op.
    params$.next(convertToParamMap({}));
    await flush();
    expect(getList$).toHaveBeenCalledTimes(1);
  });

  it('a cross-symbol doc switches the page symbol before loading', async () => {
    const { component, listStore, getList$, params$ } = setup();
    getList$.mockReturnValue(of(listDoc({ symbol: 'SPY', listId: 'run-1_SPY' })));
    component.ngOnInit();

    params$.next(convertToParamMap({ list: 'run-1_SPY' }));
    await flush();
    await flush();

    expect(component.symbol()).toBe('SPY');
    expect(listStore.symbol()).toBe('SPY');
    expect(listStore.status()).toBe('ready');
  });

  it('a missing doc names the error and never touches the chart or dialog', async () => {
    const { component, listStore, getList$, dialog, params$ } = setup();
    getList$.mockReturnValue(of(null));
    component.ngOnInit();

    params$.next(convertToParamMap({ list: 'gone' }));
    await flush();

    expect(component.listError()).toContain('gone');
    expect(listStore.activeList()).toBeNull();
    expect(dialog.open).not.toHaveBeenCalled();
    expect(component.occIdInput).toBe('');
  });

  it('a whitespace ?list= is consumed and cleared without firing a load', async () => {
    const { component, getList$, params$ } = setup();
    const router = TestBed.inject(Router) as unknown as { navigate: jest.Mock };
    component.ngOnInit();

    // An absent param on a plain load must not navigate at all.
    expect(router.navigate).not.toHaveBeenCalled();

    params$.next(convertToParamMap({ list: '   ' }));
    await flush();

    // The param is junk but still consumed — it must not linger in the URL.
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { list: null }, replaceUrl: true }),
    );
    expect(getList$).not.toHaveBeenCalled();
  });

  it('a superseded ?list= resolves late but does not apply — latest link wins', async () => {
    const { component, listStore, getList$, dialog, params$ } = setup();
    let resolveA!: (d: OptionsContractListUi | null) => void;
    const deferredA = new Promise<OptionsContractListUi | null>((r) => (resolveA = r));
    getList$.mockImplementation((id: string) =>
      id === 'list-A' ? from(deferredA) : of(listDoc({ listId: 'list-B' })),
    );
    component.ngOnInit();

    params$.next(convertToParamMap({ list: 'list-A' }));
    await flush();
    params$.next(convertToParamMap({ list: 'list-B' }));
    await flush();
    await flush();

    // B applied and opened the picker while A's fetch was still in flight.
    expect(listStore.activeList()?.listId).toBe('list-B');

    // A resolves late — the stale request must apply nothing and must
    // not stack a second picker.
    resolveA(listDoc({ listId: 'list-A' }));
    await flush();
    await flush();

    expect(listStore.activeList()?.listId).toBe('list-B');
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it('a chooser pick while a ?list= fetch is in flight invalidates the stale fetch', async () => {
    const { component, listStore, getList$, dialog, params$ } = setup();
    let resolveA!: (d: OptionsContractListUi | null) => void;
    const deferredA = new Promise<OptionsContractListUi | null>((r) => (resolveA = r));
    getList$.mockImplementation((id: string) =>
      id === 'list-A' ? from(deferredA) : of(listDoc({ listId: id })),
    );
    component.ngOnInit();

    params$.next(convertToParamMap({ list: 'list-A' }));
    await flush();

    // The chooser closes with doc B while A's fetch is still pending —
    // the handoff bumps the request seq, so A applies nothing when it
    // finally lands.
    dialog.open.mockReturnValueOnce({ afterClosed: () => of(listDoc({ listId: 'list-B' })) });
    component.openListChooser();
    await flush();
    expect(listStore.activeList()?.listId).toBe('list-B');

    resolveA(listDoc({ listId: 'list-A' }));
    await flush();
    await flush();

    expect(listStore.activeList()?.listId).toBe('list-B');
    expect(dialog.open).toHaveBeenCalledTimes(2); // chooser + one picker — no third
  });

  it('a successful doc handoff clears a stale page error', async () => {
    const { component, listStore, getList$, dialog, params$ } = setup();
    getList$.mockReturnValue(of(null));
    component.ngOnInit();

    params$.next(convertToParamMap({ list: 'gone' }));
    await flush();
    await flush();
    expect(component.listError()).toContain('gone');

    // The chip must not outlive the recovery — a stale page error would
    // also mask a later store-level failure via listErrorText precedence.
    dialog.open.mockReturnValueOnce({ afterClosed: () => of(listDoc()) });
    component.openListChooser();
    await flush();

    expect(listStore.status()).toBe('ready');
    expect(component.listError()).toBeNull();
    expect(component.listErrorText()).toBeNull();
  });

  it('a symbol change clears a stale page error', async () => {
    const { component, getList$, params$ } = setup();
    getList$.mockReturnValue(of(null));
    component.ngOnInit();

    params$.next(convertToParamMap({ list: 'gone' }));
    await flush();
    await flush();
    expect(component.listError()).toContain('gone');

    component.onSymbolChange('SPY');
    expect(component.listError()).toBeNull();
  });

  it('a failed cross-symbol doc names its error without switching the page symbol', async () => {
    const { component, listStore, getList$, dialog, params$ } = setup();
    getList$.mockReturnValue(
      of(listDoc({ symbol: 'SPY', listId: 'bad_SPY', status: 'failed', error: 'gen blew up' })),
    );
    component.ngOnInit();

    params$.next(convertToParamMap({ list: 'bad_SPY' }));
    await flush();
    await flush();

    // Shape validation precedes the switch — a bad SPY doc must not yank
    // a QQQ page through a symbol change + catalog/underlying reload.
    expect(component.symbol()).toBe('QQQ');
    expect(listStore.symbol()).toBe('QQQ');
    expect(component.listError()).toContain('bad_SPY');
    expect(component.listError()).toContain('failed');
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('a stale persisted docId surfaces a named error via listErrorText (never silent)', async () => {
    const { component, getList$ } = setup();
    saveListSession('QQQ', {
      version: LIST_SESSION_VERSION,
      docId: 'stale-doc',
      chunkSize: 10,
      cursor: 0,
      selectionKeys: [],
      dowDays: [],
      cadence: 'weekly',
    });
    getList$.mockReturnValue(of(null));
    component.ngOnInit();
    await flush();
    await flush();

    // The restore path never crosses the page-level listError — the
    // rendered union must pick up the store's named error or the
    // failure is invisible.
    expect(component.listErrorText()).toContain('stale-doc');
    expect(component.listError()).toBeNull();
  });

  it('the chooser opens filtered to the page symbol; its doc loads with no refetch and opens the picker', async () => {
    const { component, getList$, dialog, listStore } = setup();
    // The chooser's row IS the converted doc — closing with it means the
    // page must not read it again (loadListDoc, not getList$).
    const doc = listDoc();
    dialog.open.mockReturnValueOnce({ afterClosed: () => of(doc) });
    component.ngOnInit();

    component.openListChooser();
    expect(dialog.open).toHaveBeenCalledWith(
      ContractListChooserComponent,
      expect.objectContaining({ data: { symbol: 'QQQ' } }),
    );
    await flush();

    expect(getList$).not.toHaveBeenCalled();
    expect(listStore.activeList()?.listId).toBe('run-1_QQQ');
    expect(dialog.open).toHaveBeenCalledWith(
      ContractListPickerComponent,
      expect.objectContaining({ injector: expect.anything() }),
    );
  });

  it('picker send lines land in the textarea through the loadPlotted path', async () => {
    const { component, store } = setup();
    component.ngOnInit();

    component.onListSend([`2026-06-10,${QQQ_PUT}`]);
    await flush();

    expect(component.occIdInput).toBe(`2026-06-10,${QQQ_PUT}`);
    expect(store.plottedContracts()[QQQ_PUT]?.entry.openDate).toBe('2026-06-10');
  });

  it('a session send replaces an existing plotted set (no merge)', async () => {
    const { component, store } = setup();
    component.ngOnInit();

    component.onListSend([`2026-06-10,${QQQ_PUT}`]);
    await flush();
    expect(store.plottedContracts()[QQQ_PUT]).toBeTruthy();

    component.onListSend(['2026-06-11,QQQ260619P00480000']);
    await flush();
    expect(store.plottedContracts()[QQQ_PUT]).toBeUndefined();
    expect(store.plottedContracts()['QQQ260619P00480000']?.entry.openDate).toBe('2026-06-11');
  });

  it('the picker dialog receives an onSend callback that drives the load path', async () => {
    const { component, store, listStore, dialog } = setup();
    component.ngOnInit();
    listStore.setSymbol('QQQ');
    listStore.loadListDoc(listDoc());

    component.openListPicker();
    const config = dialog.open.mock.calls.at(-1)![1] as {
      data?: { onSend?: (lines: string[]) => void };
    };
    expect(config.data?.onSend).toBeInstanceOf(Function);
    // The picker is still open — openDialogs must not block the load
    // (the >50-confirm guard is scoped to the confirm, not any dialog).
    expect(dialog.openDialogs.length).toBe(1);

    // The dialog calls sendSelected() → close() → onSend(lines) — the
    // emit the store produced is what the page writes into the textarea.
    // (Empty default: select first so the send carries a line.)
    listStore.selectAll();
    config.data!.onSend!(listStore.sendSelected());
    await flush();

    expect(component.occIdInput).toBe(`2026-06-10,${QQQ_PUT}`);
    expect(store.plottedContracts()[QQQ_PUT]?.entry.openDate).toBe('2026-06-10');
  });

  it('openListPicker reopens the picker on the page injector (selection preserved)', async () => {
    const { component, listStore, getList$, dialog, params$ } = setup();
    getList$.mockReturnValue(of(listDoc()));
    component.ngOnInit();
    params$.next(convertToParamMap({ list: 'run-1_QQQ' }));
    await flush();
    await flush();
    // Close the ?list=-opened picker first — reopening is a close→open
    // cycle (a live picker dedupes, it doesn't stack).
    (dialog.openDialogs.at(-1) as MockDialogRef).close();
    dialog.open.mockClear();

    component.openListPicker();

    expect(dialog.open).toHaveBeenCalledWith(
      ContractListPickerComponent,
      expect.objectContaining({ injector: expect.anything() }),
    );
    // Same session — no reload, selection intact.
    expect(listStore.activeList()?.listId).toBe('run-1_QQQ');
    expect(getList$).toHaveBeenCalledTimes(1);
  });

  it('a second openListPicker while one is open does not stack another dialog', () => {
    const { component, dialog } = setup();
    component.ngOnInit();

    component.openListPicker();
    component.openListPicker();

    expect(dialog.openDialogs.length).toBe(1);
    expect(
      dialog.open.mock.calls.filter(([c]) => c === ContractListPickerComponent),
    ).toHaveLength(1);
  });

  it('closing the picker frees openListPicker to reopen it', () => {
    const { component, dialog } = setup();
    component.ngOnInit();

    component.openListPicker();
    (dialog.open.mock.results.at(-1)!.value as MockDialogRef).close();
    component.openListPicker();

    expect(dialog.openDialogs.length).toBe(1);
    expect(
      dialog.open.mock.calls.filter(([c]) => c === ContractListPickerComponent),
    ).toHaveLength(2);
  });

  it('ngOnDestroy closes every open dialog — the picker cannot outlive the page', () => {
    const { component, dialog } = setup();
    component.ngOnInit();
    component.openListPicker();
    expect(dialog.openDialogs.length).toBe(1);

    component.ngOnDestroy();

    expect(dialog.closeAll).toHaveBeenCalled();
    expect(dialog.openDialogs.length).toBe(0);
  });

  it('symbol change swaps the session to that symbol', () => {
    const { component, listStore } = setup();
    listStore.setSymbol('QQQ');

    component.onSymbolChange('spy');
    expect(listStore.symbol()).toBe('SPY');
  });
});

describe('OptionChartComponent — session emit seam', () => {
  beforeEach(() => localStorage.clear());

  /** 25 picks → 3 chunks at the default size 10 (10/10/5). */
  const manyRows = (): ContractListRow[] =>
    Array.from({ length: 25 }, (_, i) =>
      pickRow(
        `2026-06-${String(i + 1).padStart(2, '0')}`,
        `QQQ260619P${String(48000 + i).padStart(8, '0')}`,
      ),
    );

  const loadMany = (listStore: InstanceType<typeof ContractListSessionStore>): ContractListRow[] => {
    const rows = manyRows();
    listStore.setSymbol('QQQ');
    listStore.loadListDoc(listDoc({ rows }));
    return rows;
  };

  /** emitSessionLines is the picker's onSend seam (#1363 strip removed
   *  in #1402 — the seam survives; only the strip is gone): sent lines
   *  land in the textarea through the same loadPlotted path. */
  it('send lines land in the textarea through the loadPlotted path', async () => {
    const { component, store } = setup();
    component.ngOnInit();

    component.emitSessionLines([`2026-06-10,${QQQ_PUT}`]);
    await flush();

    expect(component.occIdInput).toBe(`2026-06-10,${QQQ_PUT}`);
    expect(store.plottedContracts()[QQQ_PUT]?.entry.openDate).toBe('2026-06-10');
  });

  /** >50 sends go through the confirm — and the sent lines only land in
   *  the textarea on approval (#1419): a cancelled send must not leave
   *  the field disagreeing with the plotted set. */
  it('a cancelled >50 send leaves the textarea untouched and loads nothing', async () => {
    const { component, store, dialog } = setup();
    component.ngOnInit();
    component.occIdInput = `2026-06-01,${QQQ_PUT}`;
    const loadSpy = jest.spyOn(store, 'loadPlotted');
    const lines = Array.from(
      { length: 60 },
      (_, i) => `2026-06-01,QQQ260619P${String(48000 + i).padStart(8, '0')}`,
    );
    dialog.open.mockReturnValueOnce({ afterClosed: () => of(false) });

    component.emitSessionLines(lines);
    await flush();
    await flush();

    expect(dialog.open).toHaveBeenCalledWith(ConfirmDialogComponent, expect.anything());
    expect(component.occIdInput).toBe(`2026-06-01,${QQQ_PUT}`);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('an approved >50 send writes the lines and loads the set', async () => {
    const { component, store, dialog } = setup();
    component.ngOnInit();
    const loadSpy = jest.spyOn(store, 'loadPlotted').mockResolvedValue(undefined);
    const lines = Array.from(
      { length: 60 },
      (_, i) => `2026-06-01,QQQ260619P${String(48000 + i).padStart(8, '0')}`,
    );
    dialog.open.mockReturnValueOnce({ afterClosed: () => of(true) });

    component.emitSessionLines(lines);
    await flush();
    await flush();

    expect(component.occIdInput).toBe(lines.join('\n'));
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('closing and reopening the picker preserves chunk cursor and selection', () => {
    const { component, listStore, dialog } = setup();
    component.ngOnInit();
    loadMany(listStore);
    component.openListPicker();

    listStore.step(1);
    listStore.selectAll();
    (dialog.openDialogs.at(-1) as MockDialogRef).close();
    dialog.open.mockClear();

    component.openListPicker();

    expect(dialog.open).toHaveBeenCalledWith(
      ContractListPickerComponent,
      expect.objectContaining({ injector: expect.anything() }),
    );
    // Same page-scoped store — nothing to restore, the state never left.
    expect(listStore.chunkCursor()).toBe(1);
    expect(listStore.selection().size).toBe(25);
  });
});
