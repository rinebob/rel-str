import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { SwingSetPickerComponent } from './swing-set-picker.component';
import type { SwingAnalysisDoc } from '../../../swing-analysis/swing-analysis.types';
import type { Pivot, Swing } from '../../../../shared/components/flex-chart/indicators/st-zigzag.types';
import {
  makeSwingAnalysisDocFixture,
  makeSwingFixture,
} from '../testing/swing-fixtures';

function mkDoc(id: string, paramsId: string, swings: Swing[] = []): SwingAnalysisDoc {
  const pivots: Pivot[] = swings.flatMap((s) => [
    { barIndex: s.start.barIndex, time: s.start.time, price: s.start.price, isHigh: s.direction === 'down', confirmed: true },
    { barIndex: s.end.barIndex, time: s.end.time, price: s.end.price, isHigh: s.direction === 'up', confirmed: true },
  ]);
  return makeSwingAnalysisDocFixture({ id, paramsId, symbol: 'MSFT', pivots, swings });
}

describe('SwingSetPickerComponent', () => {
  let fixture: ComponentFixture<SwingSetPickerComponent>;

  const sets = [
    mkDoc('MSFT_dev5', 'dev5_L5_R5_1barY_projY', [
      makeSwingFixture('2025-04-01', '2025-04-15'),
      makeSwingFixture('2025-04-15', '2025-04-30', 'down'),
    ]),
    mkDoc('MSFT_dev10', 'dev10_L3_R3_1barN_projN', [makeSwingFixture('2025-03-01', '2025-05-01')]),
  ];

  async function setup(): Promise<void> {
    await TestBed.configureTestingModule({ imports: [SwingSetPickerComponent] }).compileComponents();
    fixture = TestBed.createComponent(SwingSetPickerComponent);
    fixture.componentRef.setInput('sets', sets);
    fixture.componentRef.setInput('placeholder', 'Frame set');
    fixture.detectChanges();
  }

  beforeEach(setup);

  it('lists saved sets by paramsId in the dropdown', () => {
    const options = fixture.debugElement.queryAll(By.css('[data-testid="swing-set-select"] option'));
    // +1 for the placeholder option
    expect(options.length).toBe(3);
    expect(options[1].nativeElement.textContent).toContain('dev5_L5_R5_1barY_projY');
    expect(options[2].nativeElement.textContent).toContain('dev10_L3_R3_1barN_projN');
  });

  it('emits the set id on dropdown selection', () => {
    const emitted: string[] = [];
    fixture.componentInstance.setSelected.subscribe((id: string) => emitted.push(id));
    const select = fixture.debugElement.query(By.css('[data-testid="swing-set-select"]')).nativeElement;
    select.value = 'MSFT_dev10';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(emitted).toEqual(['MSFT_dev10']);
  });

  it('renders the zigzag expando collapsed by default, opening on toggle', () => {
    fixture.componentRef.setInput('selectedSet', sets[0]);
    fixture.detectChanges();
    const details = fixture.debugElement.query(By.css('[data-testid="zigzag-expando"]')).nativeElement as HTMLDetailsElement;
    expect(details.open).toBe(false);
    details.querySelector('summary')!.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    expect(details.open).toBe(true);
    const segments = fixture.debugElement.queryAll(By.css('[data-testid="swing-segment"]'));
    expect(segments.length).toBe(2);
  });

  it('clicking a swing segment emits that swing', () => {
    fixture.componentRef.setInput('selectedSet', sets[0]);
    fixture.detectChanges();
    const emitted: Swing[] = [];
    fixture.componentInstance.swingSelected.subscribe((s: Swing) => emitted.push(s));
    const segments = fixture.debugElement.queryAll(By.css('[data-testid="swing-segment"]'));
    segments[1].nativeElement.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toBe(sets[0].swings[1]);
  });

  it('emits on Enter/Space keydown for keyboard users', () => {
    fixture.componentRef.setInput('selectedSet', sets[0]);
    fixture.detectChanges();
    const emitted: Swing[] = [];
    fixture.componentInstance.swingSelected.subscribe((s: Swing) => emitted.push(s));
    const seg = fixture.debugElement.queryAll(By.css('[data-testid="swing-segment"]'))[0].nativeElement;
    seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    seg.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(emitted.length).toBe(2);
    expect(emitted[0]).toBe(sets[0].swings[0]);
  });

  it('hit segments carry role/tabindex/aria-label', () => {
    fixture.componentRef.setInput('selectedSet', sets[0]);
    fixture.detectChanges();
    const seg = fixture.debugElement.queryAll(By.css('[data-testid="swing-segment"]'))[0].nativeElement;
    expect(seg.getAttribute('role')).toBe('button');
    expect(seg.getAttribute('tabindex')).toBe('0');
    expect(seg.getAttribute('aria-label')).toContain('2025-04-01');
  });

  it('marks the selected swing by start/end key (not object identity)', () => {
    fixture.componentRef.setInput('selectedSet', sets[0]);
    // Equivalent-but-different object — key match must still highlight.
    const clone = makeSwingFixture('2025-04-15', '2025-04-30', 'down');
    fixture.componentRef.setInput('selectedSwing', clone);
    fixture.detectChanges();
    const hits = fixture.debugElement.queryAll(By.css('[data-testid="swing-segment"]'));
    expect(hits[1].nativeElement.getAttribute('aria-pressed')).toBe('true');
    expect(hits[0].nativeElement.getAttribute('aria-pressed')).toBe('false');
    const visuals = fixture.debugElement.queryAll(By.css('.swing-segment-visual'));
    expect(visuals[1].nativeElement.classList.contains('selected')).toBe(true);
    expect(visuals[0].nativeElement.classList.contains('selected')).toBe(false);
  });

  it('renders an empty expando (no crash) when the set has no swings', () => {
    fixture.componentRef.setInput('sets', [mkDoc('MSFT_empty', 'empty-params', [])]);
    fixture.componentRef.setInput('selectedSet', mkDoc('MSFT_empty', 'empty-params', []));
    fixture.detectChanges();
    const svg = fixture.debugElement.query(By.css('[data-testid="zigzag-expando"]'));
    expect(svg).toBeTruthy();
  });
});
