import { TestBed } from '@angular/core/testing';

import { OptionChainPctChangeComponent } from './option-chain-pct-change.component';
import { OptionChainPctChangeStore } from './option-chain-pct-change.store';
import { OptionsContractService } from '../../services/options-contract.service';
import { OptionType } from '@options-contract/contracts';
import type {
  GetHistoricalOptionsChainResponse,
  HistoricalOptionContract,
} from '@options-contract/contracts';
import { of, throwError } from 'rxjs';
import { toNum } from './utils/pct-change.utils';

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

function setupComponent(): {
  fixture: import('@angular/core/testing').ComponentFixture<OptionChainPctChangeComponent>;
  component: OptionChainPctChangeComponent;
  store: Store;
} {
  TestBed.configureTestingModule({
    imports: [OptionChainPctChangeComponent],
    providers: [
      { provide: OptionsContractService, useValue: mockService() },
      OptionChainPctChangeStore,
    ],
  });
  const fixture = TestBed.createComponent(OptionChainPctChangeComponent);
  const store = TestBed.inject(OptionChainPctChangeStore);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, store };
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

  it('renders grids after runAnalysis completes', (done) => {
    const { fixture, store } = setupComponent();
    store.setSymbol('QQQ');
    store.setStartDate('2024-01-15');
    store.addTargetDate('2024-02-15');
    store.runAnalysis();

    setTimeout(() => {
      fixture.detectChanges();
      const gridComponents = fixture.nativeElement.querySelectorAll('app-pct-change-grid');
      expect(gridComponents.length).toBe(1);
      done();
    }, 50);
  });

  it('renders error message when store has an error', (done) => {
    const failingService: Partial<OptionsContractService> = {
      getHistoricalOptionsChain$: () => throwError(() => new Error('Network error')),
    } as Partial<OptionsContractService>;

    TestBed.configureTestingModule({
      imports: [OptionChainPctChangeComponent],
      providers: [
        { provide: OptionsContractService, useValue: failingService },
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
});
