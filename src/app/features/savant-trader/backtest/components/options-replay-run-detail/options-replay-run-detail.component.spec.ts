import { TestBed } from '@angular/core/testing';
import { DsDialogService } from '../../../../../shared/ds/ds-dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';

import { OptionsReplayRunDetailComponent } from './options-replay-run-detail.component';
import { TradeSide } from '@common';
import type { OptionsContractListUi, OptionsReplayRunUi } from '../../common/options-replay.types';

function makeRun(overrides: Partial<OptionsReplayRunUi> = {}): OptionsReplayRunUi {
  return {
    runId: 'run-1',
    templateId: 'csp-45-20',
    symbols: ['SPY', 'QQQ'],
    startDate: '2026-01-02',
    status: 'running',
    totalLists: 2,
    completedLists: 1,
    failedLists: 0,
    createdAtIso: '2026-10-28T15:00:00Z',
    ...overrides,
  };
}

function makePickRow() {
  return {
    kind: 'pick' as const,
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
  };
}

function makeList(overrides: Partial<OptionsContractListUi> = {}): OptionsContractListUi {
  return {
    listId: 'run-1_SPY',
    runId: 'run-1',
    symbol: 'SPY',
    templateId: 'csp-45-20',
    status: 'success',
    rows: [],
    ...overrides,
  };
}

describe('OptionsReplayRunDetailComponent', () => {
  const dialogStub = { open: jest.fn() };

  async function setup(run = makeRun(), lists: OptionsContractListUi[] = []) {
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideRouter([]),
        { provide: DsDialogService, useValue: dialogStub },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionsReplayRunDetailComponent);
    fixture.componentRef.setInput('run', run);
    fixture.componentRef.setInput('contractLists', lists);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  it('renders the run header with resolved template name and progress', async () => {
    const { component, fixture } = await setup();
    expect(component.templateName()).toBe('45DTE 20Δ put (CSP)');
    expect(component.progressText()).toBe('1 / 2 lists');

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('45DTE 20Δ put (CSP)');
    expect(text).toContain('SPY, QQQ');
    expect(text).toContain('from 2026-01-02');
  });

  it('builds one symbol card per run symbol — missing doc shows pending', async () => {
    const { component } = await setup(makeRun(), [makeList()]);
    const views = component.symbolViews();

    expect(views.length).toBe(2);
    expect(views[0].symbol).toBe('SPY');
    expect(views[0].statusLabel).toBe('success');
    expect(views[0].rowCount).toBe(0);
    expect(views[1].symbol).toBe('QQQ');
    expect(views[1].statusLabel).toBe('pending');
    expect(views[1].rowCount).toBeNull();
  });

  it('surfaces a failed list error on its symbol card', async () => {
    const lists = [makeList({ status: 'failed', error: 'pick doc not found for SPY-put-20-45' })];
    const { component, fixture } = await setup(makeRun(), lists);

    expect(component.symbolViews()[0].statusLabel).toBe('failed');
    expect(component.symbolViews()[0].error).toContain('SPY-put-20-45');
    expect(fixture.nativeElement.textContent).toContain('pick doc not found');
  });

  it('renders a symbol card per symbol in the template', async () => {
    const { fixture } = await setup(makeRun(), [makeList()]);
    expect(fixture.nativeElement.querySelectorAll('.symbol-card').length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.symbol-card.failed').length).toBe(0);
  });

  it('keeps the row table collapsed until the row-count toggle is clicked', async () => {
    const { component, fixture } = await setup(makeRun(), [makeList({ rows: [makePickRow()] })]);
    expect(fixture.nativeElement.querySelector('app-options-replay-contract-list-table')).toBeNull();

    fixture.nativeElement.querySelector('.row-toggle').click();
    fixture.detectChanges();
    expect(component.expandedSymbols().has('SPY')).toBe(true);
    expect(fixture.nativeElement.querySelector('app-options-replay-contract-list-table')).toBeTruthy();

    fixture.nativeElement.querySelector('.row-toggle').click();
    fixture.detectChanges();
    expect(component.expandedSymbols().has('SPY')).toBe(false);
  });

  it('auto-expands the selectedSymbol card so its contract list is visible', async () => {
    const { component, fixture } = await setup(makeRun(), [
      makeList({ rows: [makePickRow()] }),
      makeList({ listId: 'run-1_QQQ', symbol: 'QQQ', rows: [makePickRow()] }),
    ]);

    expect(fixture.nativeElement.querySelector('app-options-replay-contract-list-table')).toBeNull();

    fixture.componentRef.setInput('selectedSymbol', 'QQQ');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.expandedSymbols().has('QQQ')).toBe(true);
    expect(component.expandedSymbols().has('SPY')).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('app-options-replay-contract-list-table').length).toBe(1);
  });

  it('opens the series dialog with the row contractId + symbol + entryDate', async () => {
    dialogStub.open.mockClear();
    const { component } = await setup();
    component.openSeriesDialog('SPY', makePickRow());

    expect(dialogStub.open).toHaveBeenCalledTimes(1);
    const [, config] = dialogStub.open.mock.calls[0];
    expect(config.data).toEqual({
      symbol: 'SPY',
      contractId: 'SPY260220P00550000',
      entryDate: '2026-01-05',
    });
  });

  describe('Analyze / View Results', () => {
    function analysisBtn(fixture: { nativeElement: HTMLElement }): HTMLButtonElement | null {
      return fixture.nativeElement.querySelector('.analysis-btn');
    }

    it('renders an enabled Analyze button on a success card and emits the listDocId', async () => {
      const { component, fixture } = await setup(makeRun(), [makeList()]);
      let emitted: string | null = null;
      component.analyze.subscribe((id: string) => (emitted = id));

      const btn = analysisBtn(fixture);
      expect(btn).toBeTruthy();
      expect(btn!.disabled).toBe(false);
      expect(btn!.textContent).toContain('Analyze');

      btn!.click();
      fixture.detectChanges();
      expect(emitted).toBe('run-1_SPY');
    });

    it('disables Analyze on pending and failed cards', async () => {
      const { fixture } = await setup(makeRun(), [
        makeList({ status: 'failed', listId: 'run-1_SPY' }),
      ]);
      const buttons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('.analysis-btn');
      // SPY card has a failed doc → disabled button. QQQ has no doc → no button.
      expect(buttons.length).toBe(1);
      expect(buttons[0].disabled).toBe(true);
    });

    it('renders no analysis action when the card has no list doc', async () => {
      const { fixture } = await setup(makeRun(), []);
      expect(fixture.nativeElement.querySelectorAll('.analysis-btn').length).toBe(0);
    });

    it('disables the button while its list analysis is in flight', async () => {
      const { fixture } = await setup(makeRun(), [makeList()]);
      fixture.componentRef.setInput('analyzingListIds', new Set(['run-1_SPY']));
      fixture.detectChanges();

      const btn = analysisBtn(fixture);
      expect(btn!.disabled).toBe(true);
      expect(btn!.textContent).toContain('Analyzing');
    });

    it('renders View Results link when result docs exist for the list', async () => {
      const { fixture } = await setup(makeRun(), [makeList()]);
      fixture.componentRef.setInput('analysisReadyListIds', new Set(['run-1_SPY']));
      fixture.detectChanges();

      const link: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a.analysis-btn');
      expect(link).toBeTruthy();
      expect(link!.textContent).toContain('View Results');
      expect(link!.getAttribute('href')).toBe('/options/strategy/backtest/analysis/run-1_SPY');
    });
  });
});
