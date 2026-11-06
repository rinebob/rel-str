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
    runId: 'run-1_SPY',
    templateId: 'csp-45-20',
    symbol: 'SPY',
    startDate: '2026-01-02',
    status: 'running',
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
    runId: 'run-1_SPY',
    symbol: 'SPY',
    templateId: 'csp-45-20',
    status: 'success',
    rows: [],
    ...overrides,
  };
}

describe('OptionsReplayRunDetailComponent', () => {
  const dialogStub = { open: jest.fn() };

  async function setup(run = makeRun(), list: OptionsContractListUi | null = null) {
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
    fixture.componentRef.setInput('contractList', list);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  it('renders the run header with resolved template name and the run\'s symbol', async () => {
    const { component, fixture } = await setup();
    expect(component.templateName()).toBe('45DTE 20Δ put (CSP)');

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('45DTE 20Δ put (CSP)');
    expect(text).toContain('SPY');
    expect(text).toContain('from 2026-01-02');
  });

  it('builds exactly one list card for the run — missing doc shows pending', async () => {
    const { component } = await setup(makeRun());
    const view = component.listView();

    expect(view).not.toBeNull();
    expect(view!.symbol).toBe('SPY');
    expect(view!.statusLabel).toBe('pending');
    expect(view!.rowCount).toBeNull();
  });

  it('surfaces a failed list error on the card', async () => {
    const list = makeList({ status: 'failed', error: 'pick doc not found for SPY-put-20-45' });
    const { component, fixture } = await setup(makeRun(), list);

    expect(component.listView()!.statusLabel).toBe('failed');
    expect(component.listView()!.error).toContain('SPY-put-20-45');
    expect(fixture.nativeElement.textContent).toContain('pick doc not found');
  });

  it('renders the run\'s single list card in the template', async () => {
    const { fixture } = await setup(makeRun(), makeList());
    expect(fixture.nativeElement.querySelectorAll('.list-card').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.list-card.failed').length).toBe(0);
  });

  it('expands the row table on run select — the toggle collapses/re-expands', async () => {
    const { component, fixture } = await setup(makeRun(), makeList({ rows: [makePickRow()] }));
    await fixture.whenStable();
    fixture.detectChanges();
    // Selecting a run IS intent to see its list — the card mounts expanded.
    expect(component.expanded()).toBe(true);
    expect(fixture.nativeElement.querySelector('app-options-replay-contract-list-table')).toBeTruthy();

    fixture.nativeElement.querySelector('.row-toggle').click();
    fixture.detectChanges();
    expect(component.expanded()).toBe(false);
    expect(fixture.nativeElement.querySelector('app-options-replay-contract-list-table')).toBeNull();

    fixture.nativeElement.querySelector('.row-toggle').click();
    fixture.detectChanges();
    expect(component.expanded()).toBe(true);
  });

  it('re-expands on a run switch — a manual collapse does not leak across runs', async () => {
    const { component, fixture } = await setup(makeRun(), makeList({ rows: [makePickRow()] }));
    await fixture.whenStable();
    fixture.detectChanges();
    component.toggleExpanded();
    expect(component.expanded()).toBe(false);

    fixture.componentRef.setInput('run', makeRun({ runId: 'run-2_QQQ', symbol: 'QQQ' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.expanded()).toBe(true);
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
      const { component, fixture } = await setup(makeRun(), makeList());
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

    it('disables Analyze on a failed card', async () => {
      const { fixture } = await setup(makeRun(), makeList({ status: 'failed' }));
      const buttons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('.analysis-btn');
      expect(buttons.length).toBe(1);
      expect(buttons[0].disabled).toBe(true);
    });

    it('renders no analysis action when the card has no list doc', async () => {
      const { fixture } = await setup(makeRun());
      expect(fixture.nativeElement.querySelectorAll('.analysis-btn').length).toBe(0);
    });

    it('disables the button while its list analysis is in flight', async () => {
      const { fixture } = await setup(makeRun(), makeList());
      fixture.componentRef.setInput('analyzingListIds', new Set(['run-1_SPY']));
      fixture.detectChanges();

      const btn = analysisBtn(fixture);
      expect(btn!.disabled).toBe(true);
      expect(btn!.textContent).toContain('Analyzing');
    });

    it('renders View Results link when result docs exist for the list', async () => {
      const { fixture } = await setup(makeRun(), makeList());
      fixture.componentRef.setInput('analysisReadyListIds', new Set(['run-1_SPY']));
      fixture.detectChanges();

      const link: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a.analysis-btn');
      expect(link).toBeTruthy();
      expect(link!.textContent).toContain('View Results');
      expect(link!.getAttribute('href')).toBe('/options/strategy/backtest/analysis/run-1_SPY');
    });
  });
});
