// Mock @angular/fire modules to avoid Node.js Response error from transitive imports
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn(),
}));
jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  doc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  deleteDoc: jest.fn(),
}));

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';

import { OptionChainPctChangeComponent } from './option-chain-pct-change.component';
import { OptionChainPctChangeStore } from './option-chain-pct-change.store';
import { OptionsContractService } from '../../services/options-contract.service';
import { PctChangeConfigService } from './services/pct-change-config.service';
import { SwingAnalysisService } from '../../swing-analysis/swing-analysis.service';
import { SignalService } from '../../services/signal.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import { Firestore } from '@angular/fire/firestore';
import { OptionType } from '@options-contract/contracts';
import type {
  GetHistoricalOptionsChainResponse,
  HistoricalOptionContract,
} from '@options-contract/contracts';
import type { OhlcBar } from '../../../../core/models/market-data.types';
import { of, throwError } from 'rxjs';
import { toNum } from './utils/pct-change.utils';

/** Mock MatDialog that returns a configurable afterClosed() stream. */
function mockDialog(): MatDialog & { _afterClosed$: Subject<boolean | null> } {
  const afterClosed$ = new Subject<boolean | null>();
  const dialog = {
    open: jest.fn(() => ({
      afterClosed: () => afterClosed$.asObservable(),
    })),
    _afterClosed$: afterClosed$,
  };
  return dialog as unknown as MatDialog & { _afterClosed$: Subject<boolean | null> };
}

type Store = InstanceType<typeof OptionChainPctChangeStore>;

// =============================================================================
// Test fixtures
// =============================================================================

function makeChain(contracts: HistoricalOptionContract[]): GetHistoricalOptionsChainResponse {
  return {
    ok: true,
    symbol: 'QQQ',
    date: '2024-01-15',
    endpoint: 'historical-options',
    data: { data: contracts },
    analysis: {
      summary: {
        totalContracts: contracts.length,
        totalVolume: 0,
        totalOpenInterest: 0,
        callContracts: 0,
        putContracts: 0,
        uniqueStrikes: 0,
        avgVolumePerContract: 0,
        avgOpenInterest: 0,
      },
      expirations: [],
      strikes: [],
    },
    timestamp: '2024-01-15T00:00:00Z',
    processingTimeMs: 100,
  };
}

function mockService(): Partial<OptionsContractService> {
  return {
    getHistoricalOptionsChain$: (_symbol: string, date: string) =>
      of(makeChain([
        {
          contractID: 'A',
          symbol: 'QQQ',
          expiration: '2024-03-15',
          strike: '100',
          type: OptionType.CALL,
          mark: '10.00',
          delta: '0.5',
        },
      ])),
  } as Partial<OptionsContractService>;
}

function mockConfigService(): Partial<PctChangeConfigService> {
  return {
    loadConfigs: () => of([]),
    saveConfig: () => of(undefined),
    deleteConfig: () => of(undefined),
  } as Partial<PctChangeConfigService>;
}

function mockBarReadService(bars: OhlcBar[] = []): Partial<LocalBarReadService> {
  return {
    getDailyBarsForRange$: () => of(bars),
  } as Partial<LocalBarReadService>;
}

function setupComponent(
  configService: Partial<PctChangeConfigService> = mockConfigService(),
  dialogResult: boolean | null = null,
  barReadService: Partial<LocalBarReadService> = mockBarReadService(),
): {
  fixture: import('@angular/core/testing').ComponentFixture<OptionChainPctChangeComponent>;
  component: OptionChainPctChangeComponent;
  store: Store;
  dialog: MatDialog & { _afterClosed$: Subject<boolean | null> };
} {
  const dialog = mockDialog();
  if (dialogResult !== null) {
    dialog._afterClosed$.next(dialogResult);
  }
  TestBed.configureTestingModule({
    imports: [OptionChainPctChangeComponent],
    providers: [
      { provide: OptionsContractService, useValue: mockService() },
      { provide: PctChangeConfigService, useValue: configService },
      { provide: LocalBarReadService, useValue: barReadService },
      { provide: SwingAnalysisService, useValue: { loadSavedAnalyses: () => of([]) } },
      { provide: SignalService, useValue: { getSymbolSignalHistoryFromHistory: () => of([]) } },
      { provide: Firestore, useValue: {} },
      { provide: MatDialog, useValue: dialog },
      OptionChainPctChangeStore,
    ],
  });
  const fixture = TestBed.createComponent(OptionChainPctChangeComponent);
  const store = TestBed.inject(OptionChainPctChangeStore);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, store, dialog };
}

// =============================================================================
// Tests
// =============================================================================

describe('OptionChainPctChangeComponent', () => {
  it('renders the input panel with symbol and start date inputs', () => {
    const { fixture } = setupComponent();
    const symbolInput = fixture.nativeElement.querySelector('#symbol');
    const startDateInput = fixture.nativeElement.querySelector('#startDate');
    expect(symbolInput).not.toBeNull();
    expect(startDateInput).not.toBeNull();
  });

  it('renders the placeholder message when no results', () => {
    const { fixture } = setupComponent();
    const placeholder = fixture.nativeElement.querySelector('.placeholder');
    expect(placeholder).not.toBeNull();
    expect(placeholder.textContent).toContain('Enter a symbol');
  });

  it('renders the Run button disabled when canRun is false', () => {
    const { fixture } = setupComponent();
    const runButton = fixture.nativeElement.querySelector('.actions button');
    expect(runButton.disabled).toBe(true);
  });

  it('renders the type toggle with Calls and Puts buttons', () => {
    const { fixture } = setupComponent();
    const toggleButtons = fixture.nativeElement.querySelectorAll('.type-toggle button');
    expect(toggleButtons.length).toBe(2);
    expect(toggleButtons[0].textContent).toContain('Calls');
    expect(toggleButtons[1].textContent).toContain('Puts');
  });

  it('renders the filter input sections (duration, strike, delta)', () => {
    const { fixture } = setupComponent();
    const labels = fixture.nativeElement.querySelectorAll('.form-group label');
    const labelTexts = Array.from(labels).map((l) => (l as HTMLElement).textContent);
    expect(labelTexts.some((t: string) => t.includes('Duration'))).toBe(true);
    expect(labelTexts.some((t: string) => t.includes('Strike'))).toBe(true);
    expect(labelTexts.some((t: string) => t.includes('Delta'))).toBe(true);
  });

  it('collapses and expands the input panel via the toolbar button', () => {
    const { fixture } = setupComponent();
    const panel = fixture.nativeElement.querySelector('.input-panel') as HTMLElement;
    const btn = fixture.nativeElement.querySelector('.panel-collapse-btn') as HTMLElement;
    expect(panel.classList.contains('collapsed')).toBe(false);
    btn.click();
    fixture.detectChanges();
    expect(panel.classList.contains('collapsed')).toBe(true);
    btn.click();
    fixture.detectChanges();
    expect(panel.classList.contains('collapsed')).toBe(false);
  });

  it('collapses the config panels when a saved config is selected', () => {
    const { fixture, store } = setupComponent();
    jest.spyOn(store, 'selectConfig');
    const component = fixture.componentInstance;
    component.targetDatesExpanded.set(true);
    component.filtersExpanded.set(true);
    // Dispatch a real change event so ev.target carries a real .value.
    // (An input, not a bare select — a select with no matching option
    // would report value === ''.)
    const el = document.createElement('input');
    el.value = 'cfg-1';
    let captured: Event | null = null;
    el.addEventListener('change', (e) => (captured = e));
    el.dispatchEvent(new Event('change'));
    component.onConfigSelect(captured!);
    expect(store.selectConfig).toHaveBeenCalledWith('cfg-1');
    expect(component.targetDatesExpanded()).toBe(false);
    expect(component.filtersExpanded()).toBe(false);
  });

  it('renders grids after runAnalysis completes', fakeAsync(() => {
    const { fixture, store } = setupComponent();
    store.setSymbol('QQQ');
    store.setStartDate('2024-01-15');
    store.addTargetDate('2024-02-15');
    store.runAnalysis();
    tick();
    fixture.detectChanges();
    const gridComponents = fixture.nativeElement.querySelectorAll('app-pct-change-grid');
    expect(gridComponents.length).toBe(1);
  }));

  it('renders error message when store has an error', (done) => {
    const failingService: Partial<OptionsContractService> = {
      getHistoricalOptionsChain$: () => throwError(() => new Error('Network error')),
    } as Partial<OptionsContractService>;

    TestBed.configureTestingModule({
      imports: [OptionChainPctChangeComponent],
      providers: [
        { provide: OptionsContractService, useValue: failingService },
        { provide: PctChangeConfigService, useValue: mockConfigService() },
        { provide: LocalBarReadService, useValue: mockBarReadService() },
        { provide: SwingAnalysisService, useValue: { loadSavedAnalyses: () => of([]) } },
        { provide: SignalService, useValue: { getSymbolSignalHistoryFromHistory: () => of([]) } },
        { provide: Firestore, useValue: {} },
        { provide: MatDialog, useValue: mockDialog() },
        OptionChainPctChangeStore,
      ],
    });
    const fixture = TestBed.createComponent(OptionChainPctChangeComponent);
    const store = TestBed.inject(OptionChainPctChangeStore);
    fixture.detectChanges();

    store.setSymbol('QQQ');
    store.setStartDate('2024-01-15');
    store.addTargetDate('2024-02-15');
    store.runAnalysis();

    setTimeout(() => {
      fixture.detectChanges();
      const errorEl = fixture.nativeElement.querySelector('.error');
      expect(errorEl).not.toBeNull();
      expect(errorEl.textContent).toContain('Network error');
      done();
    }, 50);
  });

  it('toNum converts string to number or undefined', () => {
    expect(toNum('')).toBeUndefined();
    expect(toNum('abc')).toBeUndefined();
    expect(toNum('100')).toBe(100);
    expect(toNum('50.5')).toBe(50.5);
  });

  it('inputValue reads string value from input event', () => {
    const { component } = setupComponent();
    const input = document.createElement('input');
    input.value = 'QQQ';
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: input, writable: false });
    expect(component.inputValue(event)).toBe('QQQ');
  });

  // ===========================================================================
  // Config UI integration
  // ===========================================================================

  describe('config UI', () => {
    it('renders the config dropdown with a default option', () => {
      const { fixture } = setupComponent();
      const select = fixture.nativeElement.querySelector('#configSelect');
      expect(select).not.toBeNull();
      const options = select.querySelectorAll('option');
      expect(options.length).toBe(1);
      expect(options[0].value).toBe('');
    });

    it('calls deselectConfig when the blank option is selected', () => {
      const { fixture, store } = setupComponent();
      const spy = jest.spyOn(store, 'deselectConfig');
      const select = fixture.nativeElement.querySelector('#configSelect');
      select.value = '';
      select.dispatchEvent(new Event('change'));
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('renders Save and Delete buttons', () => {
      const { fixture } = setupComponent();
      const buttons = fixture.nativeElement.querySelectorAll('.config-controls button');
      expect(buttons.length).toBe(2);
      expect(buttons[0].textContent).toContain('Save');
      expect(buttons[1].textContent).toContain('Delete');
    });

    it('disables Save when canRun is false', () => {
      const { fixture } = setupComponent();
      const saveBtn = fixture.nativeElement.querySelector('.config-controls button');
      expect(saveBtn.disabled).toBe(true);
    });

    it('disables Delete when no config is selected', () => {
      const { fixture } = setupComponent();
      const deleteBtn = fixture.nativeElement.querySelectorAll('.config-controls button')[1];
      expect(deleteBtn.disabled).toBe(true);
    });

    it('calls saveCurrentConfig when Save is clicked', () => {
      const { fixture, store } = setupComponent();
      const spy = jest.spyOn(store, 'saveCurrentConfig');
      store.setSymbol('QQQ');
      store.setStartDate('2025-04-07');
      store.addTargetDate('2025-04-10');
      fixture.detectChanges();
      const saveBtn = fixture.nativeElement.querySelector('.config-controls button');
      saveBtn.click();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('calls deleteConfig with confirm when Delete is clicked', () => {
      const { fixture, store, dialog } = setupComponent(mockConfigService(), true);
      const spy = jest.spyOn(store, 'deleteConfig');
      store.setSymbol('QQQ');
      store.setStartDate('2025-04-07');
      store.addTargetDate('2025-04-10');
      store.saveCurrentConfig();
      fixture.detectChanges();
      const deleteBtn = fixture.nativeElement.querySelectorAll('.config-controls button')[1];
      expect(deleteBtn.disabled).toBe(false);
      deleteBtn.click();
      // Emit the confirm result from the mock dialog
      dialog._afterClosed$.next(true);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not delete when confirm is cancelled', () => {
      const { fixture, store, dialog } = setupComponent(mockConfigService(), false);
      const spy = jest.spyOn(store, 'deleteConfig');
      store.setSymbol('QQQ');
      store.setStartDate('2025-04-07');
      store.addTargetDate('2025-04-10');
      store.saveCurrentConfig();
      fixture.detectChanges();
      const deleteBtn = fixture.nativeElement.querySelectorAll('.config-controls button')[1];
      deleteBtn.click();
      dialog._afterClosed$.next(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Target type selector integration
  // ===========================================================================

  describe('target type selector', () => {
    it('renders the target type selector component', () => {
      const { fixture } = setupComponent();
      const selector = fixture.nativeElement.querySelector('app-target-type-selector');
      expect(selector).not.toBeNull();
    });

    it('does not render the old target dates section', () => {
      const { fixture } = setupComponent();
      const oldSection = fixture.nativeElement.querySelector('.target-dates');
      expect(oldSection).toBeNull();
    });

    it('reopens the Target Dates panel when a resolve lands', () => {
      const bars: OhlcBar[] = [
        { d: '2025-04-07', o: 100, h: 100, l: 100, c: 100, v: 0 },
        { d: '2025-04-08', o: 105, h: 105, l: 105, c: 105, v: 0 },
      ];
      const { fixture, store } = setupComponent(mockConfigService(), null, mockBarReadService(bars));
      const component = fixture.componentInstance;
      component.targetDatesExpanded.set(false);
      // of() emits synchronously — the nonce bumps before this returns.
      store.resolvePctChangeTargets({ mode: 'list', values: [5] });
      fixture.detectChanges();
      expect(store.resolveNonce()).toBe(1);
      expect(component.targetDatesExpanded()).toBe(true);
    });
  });

  // ===========================================================================
  // Chart popup — outside-click dismissal
  // ===========================================================================

  describe('contract chart popup dismissal', () => {
    it('clears a pinned selection when clicking outside the overlay', () => {
      const { fixture, store } = setupComponent();
      store.pinContract(
        { contractID: 'TEST', strike: 100, expiration: '2024-03-15' },
        '2024-02-15',
      );
      expect(store.isContractPinned()).toBe(true);
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(store.selectedCell()).toBeNull();
      expect(store.isContractPinned()).toBe(false);
    });

    it('does not clear the selection when the click lands inside the chart pane', () => {
      const { fixture, store } = setupComponent();
      store.pinContract(
        { contractID: 'TEST', strike: 100, expiration: '2024-03-15' },
        '2024-02-15',
      );
      const pane = document.createElement('div');
      pane.className = 'cdk-overlay-pane contract-chart-pane';
      document.body.appendChild(pane);
      pane.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(store.selectedCell()).not.toBeNull();
      expect(store.isContractPinned()).toBe(true);
      pane.remove();
    });

    it('clears the selection when the click lands inside a different overlay pane', () => {
      const { fixture, store } = setupComponent();
      store.pinContract(
        { contractID: 'TEST', strike: 100, expiration: '2024-03-15' },
        '2024-02-15',
      );
      const foreignPane = document.createElement('div');
      foreignPane.className = 'cdk-overlay-pane mat-select-panel';
      document.body.appendChild(foreignPane);
      foreignPane.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(store.selectedCell()).toBeNull();
      foreignPane.remove();
    });
  });
});
