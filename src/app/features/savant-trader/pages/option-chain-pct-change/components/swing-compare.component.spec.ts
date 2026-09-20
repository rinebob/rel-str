import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { SwingCompareComponent } from './swing-compare.component';
import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';
import { OptionsContractService } from '../../../services/options-contract.service';
import { PctChangeConfigService } from '../services/pct-change-config.service';
import { LocalBarReadService } from '../../../../../core/services/local-bar-read.service';
import { SwingAnalysisService } from '../../../swing-analysis/swing-analysis.service';
import { SymbolHistoryStore } from '../../../stores/symbol-history.store';
import { OptionType } from '@options-contract/contracts';
import type { Swing } from '../../../../shared/components/flex-chart/indicators/st-zigzag.types';
import {
  fixtureMs,
  makePivotFixture,
  makeSwingAnalysisDocFixture,
  makeSignalFixture,
  makeSwingFixture,
} from '../testing/swing-fixtures';

describe('SwingCompareComponent', () => {
  let fixture: ComponentFixture<SwingCompareComponent>;
  let store: InstanceType<typeof OptionChainPctChangeStore>;

  const mkPivot = (time: string, isHigh = false) =>
    makePivotFixture({ time: fixtureMs(time), isHigh });
  const mkSwing = (start: string, end: string, dir: 'up' | 'down' = 'up'): Swing =>
    makeSwingFixture(start, end, dir);

  const frameDoc = makeSwingAnalysisDocFixture({
    id: 'MSFT_frame',
    paramsId: 'frame-p',
    swings: [mkSwing('2025-04-01', '2025-04-30')],
  });
  const extremesDoc = makeSwingAnalysisDocFixture({
    id: 'MSFT_extremes',
    paramsId: 'extremes-p',
    pivots: [
      mkPivot('2025-04-10', true),   // high
      mkPivot('2025-04-15', false),  // low
    ],
  });

  function seedStore(): void {
    store.setSymbol('MSFT'); // triggers loadSwingData → savedAnalyses + signals
    store.selectFrameSet('MSFT_frame');
    store.selectExtremesSet('MSFT_extremes');
    store.selectFrameSwing(frameDoc.swings[0]);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SwingCompareComponent],
      providers: [
        { provide: OptionsContractService, useValue: { getHistoricalOptionsChain$: jest.fn(() => of({ ok: true, data: { data: [] } })) } },
        { provide: PctChangeConfigService, useValue: { getSavedConfigs$: jest.fn(() => of([])) } },
        { provide: LocalBarReadService, useValue: { getDailyBarsForRange$: jest.fn(() => of([])) } },
        { provide: SwingAnalysisService, useValue: { loadSavedAnalyses: jest.fn(() => of([frameDoc, extremesDoc])) } },
        {
          provide: SymbolHistoryStore,
          useValue: {
            signalHistoryCache: signal({ MSFT: [makeSignalFixture({ barDate: '2025-04-12' })] }),
            loadSignalHistory: jest.fn(),
          },
        },
        { provide: Firestore, useValue: {} },
        OptionChainPctChangeStore,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SwingCompareComponent);
    store = TestBed.inject(OptionChainPctChangeStore);
    seedStore();
    fixture.detectChanges();
  });

  it('renders frame + extremes set pickers', () => {
    const pickers = fixture.debugElement.queryAll(By.css('app-swing-set-picker'));
    expect(pickers.length).toBe(2);
  });

  it('renders the date list with labels', () => {
    const items = fixture.debugElement.queryAll(By.css('[data-testid="date-item"]'));
    const texts = items.map((i) => i.nativeElement.textContent);
    // frame start + 2 extremes pivots + 1 signal
    expect(items.length).toBe(4);
    expect(texts.some((t) => t.includes('2025-04-01') && t.includes('frame-start'))).toBe(true);
    expect(texts.some((t) => t.includes('2025-04-10') && t.includes('swing-high'))).toBe(true);
    expect(texts.some((t) => t.includes('2025-04-12') && t.includes('LONG'))).toBe(true);
    expect(texts.some((t) => t.includes('2025-04-15') && t.includes('swing-low'))).toBe(true);
  });

  it('hides the date list and run builder until a frame swing is picked', () => {
    store.selectFrameSwing(null);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="date-list"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="run-start-select"]'))).toBeNull();
  });

  it('start dropdown lists date-list dates; targets show only post-start', () => {
    const startSelect = fixture.debugElement.query(By.css('[data-testid="run-start-select"]'));
    const options = startSelect.queryAll(By.css('option'));
    // +1 placeholder
    expect(options.length).toBe(5);

    // Pick the 04-10 high → candidates are exactly the two later dates.
    startSelect.nativeElement.value = '2025-04-10';
    startSelect.nativeElement.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const dates = fixture.debugElement
      .queryAll(By.css('[data-testid="target-checkbox"]'))
      .map((d) => (d.nativeElement.textContent as string).trim().slice(0, 10));
    expect(dates).toEqual(['2025-04-12', '2025-04-15']);
  });

  it('add-run is disabled until a start and at least one target are chosen', () => {
    const btn = () => fixture.debugElement.query(By.css('[data-testid="add-run-btn"]')).nativeElement;
    expect(btn().disabled).toBe(true);

    fixture.debugElement.query(By.css('[data-testid="run-start-select"]')).nativeElement.value = '2025-04-01';
    fixture.debugElement.query(By.css('[data-testid="run-start-select"]')).nativeElement.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(btn().disabled).toBe(true);

    const checkbox = fixture.debugElement.query(By.css('[data-testid="target-checkbox"] input')).nativeElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(btn().disabled).toBe(false);
  });

  it('picking a new start clears stale target selections', () => {
    const startSelect = fixture.debugElement.query(By.css('[data-testid="run-start-select"]')).nativeElement;
    startSelect.value = '2025-04-01';
    startSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const checkbox = fixture.debugElement.query(By.css('[data-testid="target-checkbox"] input')).nativeElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    startSelect.value = '2025-04-12';
    startSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const checked = fixture.debugElement.queryAll(By.css('[data-testid="target-checkbox"] input'))
      .filter((d) => d.nativeElement.checked);
    expect(checked.length).toBe(0);
  });

  it('clears the builder draft when the frame swing changes', () => {
    const startSelect = fixture.debugElement.query(By.css('[data-testid="run-start-select"]')).nativeElement;
    startSelect.value = '2025-04-01';
    startSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const checkbox = fixture.debugElement.query(By.css('[data-testid="target-checkbox"] input')).nativeElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.canAddRun()).toBe(true);

    store.selectFrameSwing(makeSwingFixture('2025-05-01', '2025-05-20'));
    fixture.detectChanges();

    expect(fixture.componentInstance.canAddRun()).toBe(false);
    expect(fixture.componentInstance.builderStart()).toBeNull();
  });

  it('defaults type to PUT for a high-pivot start and CALL for a low-pivot start', () => {
    const startSelect = fixture.debugElement.query(By.css('[data-testid="run-start-select"]')).nativeElement;
    const typeSelect = () => fixture.debugElement.query(By.css('[data-testid="run-type-select"]')).nativeElement;

    startSelect.value = '2025-04-10'; // swing-high
    startSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(typeSelect().value).toBe(OptionType.PUT);

    startSelect.value = '2025-04-15'; // swing-low
    startSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(typeSelect().value).toBe(OptionType.CALL);

    // Overridable: switch back to CALL manually
    typeSelect().value = OptionType.CALL;
    typeSelect().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    startSelect.value = '2025-04-10';
    startSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    // Fresh start re-derives the default (builder reset on start change)
    expect(typeSelect().value).toBe(OptionType.PUT);
  });

  it('add run appends a numbered run section', () => {
    const startSelect = fixture.debugElement.query(By.css('[data-testid="run-start-select"]')).nativeElement;
    startSelect.value = '2025-04-10';
    startSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const checkbox = fixture.debugElement.query(By.css('[data-testid="target-checkbox"] input')).nativeElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    fixture.debugElement.query(By.css('[data-testid="add-run-btn"]')).nativeElement.click();
    fixture.detectChanges();

    expect(store.runs().length).toBe(1);
    expect(store.runs()[0].startDate).toBe('2025-04-10');
    expect(store.runs()[0].type).toBe(OptionType.PUT);
    const sections = fixture.debugElement.queryAll(By.css('app-run-section'));
    expect(sections.length).toBe(1);
    expect(sections[0].nativeElement.textContent).toContain('Run 1');
  });

  it('remove deletes the run', () => {
    store.addRun('2025-04-01', ['2025-04-10'], OptionType.CALL);
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('app-run-section')).length).toBe(1);

    fixture.debugElement.query(By.css('[data-testid="remove-run-btn"]')).nativeElement.click();
    fixture.detectChanges();
    expect(store.runs()).toEqual([]);
  });
});
