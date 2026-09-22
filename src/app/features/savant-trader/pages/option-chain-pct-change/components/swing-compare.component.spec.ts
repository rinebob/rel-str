/**
 * SwingCompareComponent — results-side section: a hint until a frame
 * swing is chosen, then the run list (RunSection per run). The set
 * pickers + run builder live in the frame-swing dialog now.
 */
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
    config: { ...makeSwingAnalysisDocFixture().config, devThreshold: 10 },
    swings: [mkSwing('2025-04-01', '2025-04-30')],
  });
  const extremesDoc = makeSwingAnalysisDocFixture({
    id: 'MSFT_extremes',
    paramsId: 'extremes-p',
    config: { ...makeSwingAnalysisDocFixture().config, devThreshold: 2 },
    pivots: [
      mkPivot('2025-04-10', true),
      mkPivot('2025-04-15', false),
    ],
  });

  function seedStore(): void {
    store.setSymbol('MSFT'); // triggers loadSwingData → savedAnalyses + signals
    store.selectBaselineSet('MSFT_frame');
    store.selectFrameSwing(frameDoc.swings[0]);
  }

  function makeProviders(analyses = [frameDoc, extremesDoc]) {
    return [
      { provide: OptionsContractService, useValue: { getHistoricalOptionsChain$: jest.fn(() => of({ ok: true, data: { data: [] } })) } },
      { provide: PctChangeConfigService, useValue: { getSavedConfigs$: jest.fn(() => of([])) } },
      { provide: LocalBarReadService, useValue: { getDailyBarsForRange$: jest.fn(() => of([])) } },
      { provide: SwingAnalysisService, useValue: { loadSavedAnalyses: jest.fn(() => of(analyses)) } },
      {
        provide: SymbolHistoryStore,
        useValue: {
          signalHistoryCache: signal({ MSFT: [makeSignalFixture({ barDate: '2025-04-12' })] }),
          loadSignalHistory: jest.fn(),
        },
      },
      { provide: Firestore, useValue: {} },
      OptionChainPctChangeStore,
    ];
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SwingCompareComponent],
      providers: makeProviders(),
    }).compileComponents();
    fixture = TestBed.createComponent(SwingCompareComponent);
    store = TestBed.inject(OptionChainPctChangeStore);
    seedStore();
    fixture.detectChanges();
  });

  it('renders only the run list — no title or hint', () => {
    expect(fixture.debugElement.query(By.css('[data-testid="swing-compare-hint"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.section-title'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.run-list'))).toBeTruthy();
  });

  it('renders a numbered run section per run', () => {
    store.addRun('2025-04-01', ['2025-04-10'], OptionType.CALL);
    store.addRun('2025-04-10', ['2025-04-15'], OptionType.PUT);
    fixture.detectChanges();

    const sections = fixture.debugElement.queryAll(By.css('app-run-section'));
    expect(sections.length).toBe(2);
    expect(sections[0].nativeElement.textContent).toContain('Run 1');
    expect(sections[1].nativeElement.textContent).toContain('Run 2');
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
