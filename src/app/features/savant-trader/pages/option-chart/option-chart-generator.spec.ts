/// <reference types="jest" />
/**
 * Page ↔ generator wiring specs for OptionChartComponent. The component is
 * instantiated but never rendered — the specs exercise the handoff methods
 * (send → textarea + loadPlotted, symbol change → generator store swap)
 * with the real stores and mocked services. The store under test is the
 * same page-scoped instance the component injects.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { OptionChartComponent } from './option-chart.component';
import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import { OptionGroupGeneratorStore } from '../../stores/option-group-generator.store';
import { OptionsContractService } from '../../services/options-contract.service';
import { ContractAvailabilityService } from '../../services/contract-availability.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import type { PartnerHistoricalOptionsContractV2Response } from '../../../../core/models/partner.types';

const QQQ_PUT = 'QQQ260619P00470000';
const QQQ_CALL = 'QQQ260619C00475000';

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
  genStore: InstanceType<typeof OptionGroupGeneratorStore>;
  component: OptionChartComponent;
  getHistorical: jest.Mock;
}

function setup(): Setup {
  const getHistorical = jest.fn((_s: string, cid: string) => of(contractResponse(cid)));

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      OptionGroupGeneratorStore,
      {
        provide: OptionsContractService,
        useValue: {
          getHistoricalOptionsContract$: getHistorical,
          getContractIndex$: jest.fn(() => of({ expirations: [], strikes: [] })),
          getContractCatalogSummary$: jest.fn(() => of(null)),
        },
      },
      { provide: ContractAvailabilityService, useValue: { queryContractAvailability$: jest.fn() } },
      { provide: LocalBarReadService, useValue: { getDailyBarsForRange$: jest.fn(() => of([])) } },
      { provide: MatDialog, useValue: { open: jest.fn(), openDialogs: [] } },
    ],
  });

  return {
    store: TestBed.inject(OptionsContractViewerStore),
    genStore: TestBed.inject(OptionGroupGeneratorStore),
    component: TestBed.runInInjectionContext(() => new OptionChartComponent()),
    getHistorical,
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe('OptionChartComponent — generator wiring', () => {
  beforeEach(() => localStorage.clear());

  it('send writes the textarea and routes through the loadPlotted path', async () => {
    const { store, component } = setup();

    component.onGeneratorSend([`2026-06-10,${QQQ_PUT}`, `2026-06-10,${QQQ_CALL}`]);
    await flush();

    expect(component.occIdInput).toBe(`2026-06-10,${QQQ_PUT}\n2026-06-10,${QQQ_CALL}`);
    expect(store.plottedContracts()[QQQ_PUT]?.entry.openDate).toBe('2026-06-10');
    expect(store.plottedContracts()[QQQ_CALL]?.status).toBe('loaded');
    expect(component.showPlottedSet()).toBe(true);
  });

  it('a send replaces the previously plotted set rather than unioning', async () => {
    const { store, component, getHistorical } = setup();
    // Dated pairs force the plotted-set path even for a one-contract send.
    component.onGeneratorSend([`2026-06-10,${QQQ_PUT}`, `2026-06-10,${QQQ_CALL}`]);
    await flush();
    expect(store.plottedContracts()[QQQ_PUT]).toBeTruthy();

    component.onGeneratorSend([`2026-06-10,${QQQ_CALL}`]);
    await flush();

    expect(store.plottedContracts()[QQQ_PUT]).toBeUndefined();
    expect(store.plottedContracts()[QQQ_CALL]?.status).toBe('loaded');
    // The kept contract was not refetched — replace semantics only drop the
    // absent ones.
    expect(getHistorical.mock.calls.filter(([, cid]) => cid === QQQ_CALL)).toHaveLength(1);
  });

  it('symbol change swaps the generator store to that symbol', () => {
    const { genStore, component } = setup();
    genStore.setSymbol('QQQ');

    component.onSymbolChange('spy');
    expect(genStore.symbol()).toBe('SPY');
  });

  it('ngOnInit points the generator at the initial symbol', () => {
    const { genStore, component } = setup();
    component.ngOnInit();

    expect(genStore.symbol()).toBe('QQQ');
  });

  it('chart studyRange routes to the generator alive-range bound', () => {
    const { genStore, component } = setup();
    genStore.setSymbol('QQQ');

    component.onStudyRange({ start: '2026-05-01', end: '2026-06-01' });
    expect(genStore.refine().aliveRange).toEqual({ start: '2026-05-01', end: '2026-06-01' });

    component.onStudyRange(null);
    expect(genStore.refine().aliveRange).toBeUndefined();
  });
});
