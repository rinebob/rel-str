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
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import { Firestore } from '@angular/fire/firestore';
import { OptionType } from '@options-contract/contracts';
import type {
  GetHistoricalOptionsChainResponse,
  HistoricalOptionContract,
} from '@options-contract/contracts';
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

function mockBarReadService(): Partial<LocalBarReadService> {
  return {
    getDailyBarsForRange$: () => of([]),
  } as Partial<LocalBarReadService>;
}

function setupComponent(
  configService: Partial<PctChangeConfigService> = mockConfigService(),
  dialogResult: boolean | null = null,
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
      { provide: LocalBarReadService, useValue: mockBarReadService() },
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

    it('calls setTargetType when targetTypeChange fires', () => {
      const { fixture, store } = setupComponent();
      const spy = jest.spyOn(store, 'setTargetType');
      fixture.componentInstance.onTargetTypeChange('user-dates');
      expect(spy).toHaveBeenCalledWith('user-dates');
    });

    it('calls setTargetDates when targetDatesChange fires', () => {
      const { fixture, store } = setupComponent();
      const spy = jest.spyOn(store, 'setTargetDates');
      fixture.componentInstance.onTargetDatesChange(['2025-04-10', '2025-04-15']);
      expect(spy).toHaveBeenCalledWith(['2025-04-10', '2025-04-15']);
    });

    it('calls setPctMode when pctModeChange fires', () => {
      const { fixture, store } = setupComponent();
      const spy = jest.spyOn(store, 'setPctMode');
      fixture.componentInstance.onPctModeChange('gradation');
      expect(spy).toHaveBeenCalledWith('gradation');
    });

    it('calls setPctParams when pctParamsChange fires', () => {
      const { fixture, store } = setupComponent();
      const spy = jest.spyOn(store, 'setPctParams');
      fixture.componentInstance.onPctParamsChange({
        mode: 'gradation',
        values: [-3, 5],
        step: 2,
        count: 6,
        direction: 'down',
      });
      expect(spy).toHaveBeenCalledWith([-3, 5], 2, 6, 'down');
    });

    it('calls setUserDatesMode when userDatesModeChange fires', () => {
      const { fixture, store } = setupComponent();
      const spy = jest.spyOn(store, 'setUserDatesMode');
      fixture.componentInstance.onUserDatesModeChange('interval');
      expect(spy).toHaveBeenCalledWith('interval');
    });

    it('calls setIntervalParams when intervalParamsChange fires', () => {
      const { fixture, store } = setupComponent();
      const spy = jest.spyOn(store, 'setIntervalParams');
      fixture.componentInstance.onIntervalParamsChange({ count: 3, intervalDays: 7 });
      expect(spy).toHaveBeenCalledWith(3, 7);
    });

    it('calls resolvePctChangeTargets when resolvePctChangeRequest fires', () => {
      const { fixture, store } = setupComponent();
      const spy = jest.spyOn(store, 'resolvePctChangeTargets');
      const request = { mode: 'list' as const, values: [-3, 5, 10] };
      fixture.componentInstance.onResolvePctChangeRequest(request);
      expect(spy).toHaveBeenCalledWith(request);
    });
  });
});
