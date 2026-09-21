/**
 * FrameSwingPickerDialogComponent — the swing-compare builder dialog.
 * Baseline Set dropdown → clickable zigzag → Target Set dropdown
 * (finer dev only) → small-swing chart → start/target/type → Add run.
 * Everything commits to the store; Done just closes.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogClose,
  MatDialogRef,
} from '@angular/material/dialog';

import { FrameSwingPickerDialogComponent } from './frame-swing-dialog.component';
import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';
import { OptionsContractService } from '../../../services/options-contract.service';
import { PctChangeConfigService } from '../services/pct-change-config.service';
import { LocalBarReadService } from '../../../../../core/services/local-bar-read.service';
import { SwingAnalysisService } from '../../../swing-analysis/swing-analysis.service';
import { SymbolHistoryStore } from '../../../stores/symbol-history.store';
import { OptionType } from '@options-contract/contracts';
import {
  makePivotFixture,
  makeSwingAnalysisDocFixture,
  makeSwingFixture,
  makeSignalFixture,
  fixtureMs,
} from '../testing/swing-fixtures';
import type { Swing } from '../../../../shared/components/flex-chart/indicators/st-zigzag.types';

describe('FrameSwingPickerDialogComponent', () => {
  let fixture: ComponentFixture<FrameSwingPickerDialogComponent>;
  let store: InstanceType<typeof OptionChainPctChangeStore>;
  let closeSpy: jest.Mock;

  const mkPivot = (time: string, isHigh = false, price = 100) =>
    makePivotFixture({ time: fixtureMs(time), isHigh, price });
  const mkSwing = (start: string, end: string, dir: 'up' | 'down' = 'up'): Swing =>
    makeSwingFixture(start, end, dir);

  const baselineDoc = makeSwingAnalysisDocFixture({
    id: 'QQQ_base',
    paramsId: 'dev10_L5_R5',
    config: { ...makeSwingAnalysisDocFixture().config, devThreshold: 10 },
    pivots: [
      mkPivot('2025-04-01', false, 480),
      mkPivot('2025-04-30', true, 530),
      mkPivot('2025-05-05', false, 500),
      mkPivot('2025-05-20', true, 520),
    ],
    swings: [
      mkSwing('2025-04-01', '2025-04-30'),
      mkSwing('2025-05-05', '2025-05-20'),
    ],
  });
  const targetDoc = makeSwingAnalysisDocFixture({
    id: 'QQQ_target',
    paramsId: 'dev2_L3_R3',
    config: { ...makeSwingAnalysisDocFixture().config, devThreshold: 2 },
    pivots: [
      mkPivot('2025-04-10', true, 512.5),
      mkPivot('2025-04-15', false, 488.25),
      mkPivot('2025-04-22', true, 525),
      mkPivot('2025-06-01', true, 540),   // outside the frame — clipped
      mkPivot('2025-06-10', false, 505),  // outside the frame — clipped
    ],
    swings: [
      mkSwing('2025-04-10', '2025-04-15', 'down'),   // inside the frame
      mkSwing('2025-04-15', '2025-04-22'),           // inside the frame
      mkSwing('2025-06-01', '2025-06-10', 'down'),   // outside the frame
    ],
  });
  const altTargetDoc = makeSwingAnalysisDocFixture({
    id: 'QQQ_target_b',
    paramsId: 'dev3_L3_R3',
    config: { ...makeSwingAnalysisDocFixture().config, devThreshold: 3 },
    pivots: [
      mkPivot('2025-04-08', false, 495),
      mkPivot('2025-04-20', true, 520),
    ],
    swings: [mkSwing('2025-04-08', '2025-04-20')],
  });
  const sets = [baselineDoc, targetDoc, altTargetDoc];
  async function setup(selectedSetId: string | null = null, selectedSwing: Swing | null = null) {
    closeSpy = jest.fn();
    await TestBed.configureTestingModule({
      imports: [FrameSwingPickerDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { sets, selectedSetId, selectedSwing } },
        { provide: MatDialogRef, useValue: { close: closeSpy } },
        {
          provide: OptionsContractService,
          useValue: { getHistoricalOptionsChain$: jest.fn(() => of({ ok: true, data: { data: [] } })) },
        },
        { provide: PctChangeConfigService, useValue: { getSavedConfigs$: jest.fn(() => of([])) } },
        { provide: LocalBarReadService, useValue: { getDailyBarsForRange$: jest.fn(() => of([])) } },
        { provide: SwingAnalysisService, useValue: { loadSavedAnalyses: jest.fn(() => of(sets)) } },
        {
          provide: SymbolHistoryStore,
          useValue: {
            signalHistoryCache: signal({ QQQ: [makeSignalFixture({ barDate: '2025-04-12' })] }),
            loadSignalHistory: jest.fn(),
          },
        },
        { provide: Firestore, useValue: {} },
        OptionChainPctChangeStore,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FrameSwingPickerDialogComponent);
    store = TestBed.inject(OptionChainPctChangeStore);
    // Symbol already defaults to QQQ — loadSwingData loads the analyses
    // + signals without needing a symbol change.
    store.loadSwingData();
    fixture.detectChanges();
  }

  function pickBaseline(id: string): void {
    const select = fixture.debugElement.query(By.css('[data-testid="baseline-set-select"]')).nativeElement;
    select.value = id;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function pickFirstSegment(): void {
    fixture.debugElement.query(By.css('[data-testid="swing-segment"]'))
      .nativeElement.dispatchEvent(new Event('click'));
    fixture.detectChanges();
  }

  it('renders a Baseline Set dropdown listing every saved set', async () => {
    await setup();
    const options = fixture.debugElement
      .query(By.css('[data-testid="baseline-set-select"]'))
      .queryAll(By.css('option'));
    expect(options.length).toBe(4); // placeholder + three sets
    expect(options[1].nativeElement.textContent).toContain('dev10_L5_R5');
    expect(options[2].nativeElement.textContent).toContain('dev2_L3_R3');
  });

  it('picking a baseline shows its swings; clicking a segment commits set + swing', async () => {
    await setup();
    pickBaseline('QQQ_base');
    const segs = fixture.debugElement.queryAll(By.css('[data-testid="swing-segment"]'));
    const rows = fixture.debugElement.queryAll(By.css('[data-testid="swing-row"]'));
    expect(segs.length).toBe(2);
    expect(rows.length).toBe(2);

    segs[0].nativeElement.dispatchEvent(new Event('click'));
    expect(store.baselineSetId()).toBe('QQQ_base');
    expect(store.frameSwing()).toBe(baselineDoc.swings[0]);
  });

  it('after the frame is picked the Target Set dropdown shows only finer sets', async () => {
    await setup();
    pickBaseline('QQQ_base');
    pickFirstSegment();

    const select = fixture.debugElement.query(By.css('[data-testid="target-set-select"]'));
    expect(select).toBeTruthy();
    const options = select.queryAll(By.css('option'));
    expect(options.length).toBe(2); // dev2 + dev3, both finer than dev10
    expect(options[0].nativeElement.textContent).toContain('dev2_L3_R3');
    // selectBaselineSet already defaulted the target to the finest set.
    expect(store.targetSetId()).toBe('QQQ_target');
  });

  it('renders only the in-frame small swings — out-of-frame swings are clipped', async () => {
    await setup();
    pickBaseline('QQQ_base');
    pickFirstSegment(); // frame 2025-04-01 → 2025-04-30

    const small = fixture.debugElement.query(By.css('svg.small'));
    expect(small).toBeTruthy();
    // QQQ_target has 3 swings; the two April ones are in the frame.
    expect(small.queryAll(By.css('.target-segment')).length).toBe(2);
  });

  it('draws a hairline + date label per in-frame pivot', async () => {
    await setup();
    pickBaseline('QQQ_base');
    pickFirstSegment();

    const small = fixture.debugElement.query(By.css('svg.small'));
    const hairlines = small.queryAll(By.css('.pivot-hairline'));
    const labels = small.queryAll(By.css('.pivot-label'));
    expect(hairlines.length).toBe(3); // 04-10, 04-15, 04-22 — June pivots clipped
    expect(labels.length).toBe(3);
    expect(labels.map((l) => l.nativeElement.textContent.trim())).toEqual([
      '2025-04-10', '2025-04-15', '2025-04-22',
    ]);
  });

  it('clicking small swings checks their endpoint dates — first click prefills the run', async () => {
    await setup();
    pickBaseline('QQQ_base');
    pickFirstSegment(); // frame 04-01 → 04-30

    const hits = fixture.debugElement.queryAll(By.css('[data-testid="target-segment-hit"]'));
    expect(hits.length).toBe(2);

    // First click prefills: start = swing start, type from direction, end checked.
    hits[0].nativeElement.dispatchEvent(new Event('click')); // 04-10→04-15 (down)
    fixture.detectChanges();
    expect(fixture.componentInstance.builderStart()).toBe('2025-04-10');
    expect(fixture.componentInstance.builderType()).toBe(OptionType.PUT);
    expect([...fixture.componentInstance.builderTargets()]).toEqual(['2025-04-15']);

    // Second swing toggles its endpoints into the same run.
    hits[1].nativeElement.dispatchEvent(new Event('click')); // 04-15→04-22 (up)
    fixture.detectChanges();
    expect([...fixture.componentInstance.builderTargets()].sort())
      .toEqual(['2025-04-15', '2025-04-22']);
    expect(fixture.componentInstance.builderStart()).toBe('2025-04-10'); // unchanged

    // Checked swings highlight.
    expect(fixture.debugElement.queryAll(By.css('.target-segment.picked')).length).toBe(2);

    // Add run commits them all.
    fixture.debugElement.query(By.css('[data-testid="add-run-btn"]')).nativeElement.click();
    fixture.detectChanges();
    expect(store.runs().length).toBe(1);
    expect(store.runs()[0].startDate).toBe('2025-04-10');
    expect(store.runs()[0].targetDates).toEqual(['2025-04-15', '2025-04-22']);
    expect(store.runs()[0].type).toBe(OptionType.PUT);
  });

  it('switching the target set replaces the chart — no leftover lines', async () => {
    await setup();
    pickBaseline('QQQ_base');
    pickFirstSegment();
    expect(fixture.debugElement.queryAll(By.css('.target-segment')).length).toBe(2);

    const select = fixture.debugElement.query(By.css('[data-testid="target-set-select"]')).nativeElement;
    select.value = 'QQQ_target_b';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const segs = fixture.debugElement.queryAll(By.css('.target-segment'));
    expect(segs.length).toBe(1); // alt doc's single in-frame swing — not 2
    expect(store.targetSetId()).toBe('QQQ_target_b');
    // Still one svg element — the chart was replaced, not appended.
    expect(fixture.debugElement.queryAll(By.css('svg.small')).length).toBe(1);
  });

  it('run builder: start → target checkboxes with extreme values → Add run commits', async () => {
    await setup();
    pickBaseline('QQQ_base');
    pickFirstSegment(); // frame 2025-04-01 → 2025-04-30

    const startSelect = fixture.debugElement.query(By.css('[data-testid="run-start-select"]')).nativeElement;
    startSelect.value = '2025-04-01';
    startSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // Candidates: pivots 04-10/04-15/04-22 + signal 04-12 — with prices.
    const texts = fixture.debugElement
      .queryAll(By.css('[data-testid="target-checkbox"]'))
      .map((d) => d.nativeElement.textContent as string);
    expect(texts.length).toBe(4);
    expect(texts.some((t) => t.includes('2025-04-10') && t.includes('512.50'))).toBe(true);
    expect(texts.some((t) => t.includes('2025-04-15') && t.includes('488.25'))).toBe(true);

    // Select-all, then add.
    fixture.debugElement.query(By.css('[data-testid="targets-select-all"]')).nativeElement.click();
    fixture.detectChanges();
    const addBtn = fixture.debugElement.query(By.css('[data-testid="add-run-btn"]')).nativeElement;
    expect(addBtn.disabled).toBe(false);
    addBtn.click();
    fixture.detectChanges();

    expect(store.runs().length).toBe(1);
    expect(store.runs()[0].startDate).toBe('2025-04-01');
    expect(store.runs()[0].targetDates).toEqual(['2025-04-10', '2025-04-12', '2025-04-15', '2025-04-22']);
    // Frame start is a confirmed low → CALL default.
    expect(store.runs()[0].type).toBe(OptionType.CALL);
  });

  it('highlights the currently selected swing by time key', async () => {
    await setup('QQQ_base', makeSwingFixture('2025-04-01', '2025-04-30'));
    // Commit the preselected state so the chart reflects it.
    store.selectBaselineSet('QQQ_base');
    store.selectFrameSwing(baselineDoc.swings[0]);
    fixture.detectChanges();
    const segs = fixture.debugElement.queryAll(By.css('.swing-segment-visual.selected'));
    expect(segs.length).toBe(1);
  });

  it('Done closes the dialog; runs accumulate while it is open', async () => {
    await setup();
    pickBaseline('QQQ_base');
    pickFirstSegment();
    const startSelect = fixture.debugElement.query(By.css('[data-testid="run-start-select"]')).nativeElement;
    startSelect.value = '2025-04-01';
    startSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    fixture.debugElement.query(By.css('[data-testid="targets-select-all"]')).nativeElement.click();
    fixture.detectChanges(); // flush — disabled state updates on CD
    fixture.debugElement.query(By.css('[data-testid="add-run-btn"]')).nativeElement.click();
    fixture.detectChanges();

    const footer = fixture.debugElement.query(By.css('.runs-count'));
    expect(footer.nativeElement.textContent).toContain('Runs: 1');
    const done = fixture.debugElement.query(By.directive(MatDialogClose));
    expect(done.nativeElement.textContent).toContain('Done');
  });
});
