/**
 * WorkbenchToolsComponent spec (#1085) — the workbench tools row: save-
 * slice inline form (draft resets on cancel so abandoned text can't
 * resurrect), persistent skip notices (slice + compare sides), and the
 * compare picker/chip round-trip.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { WorkbenchToolsComponent } from './workbench-tools.component';
import { PaperTradingKind } from '@paper-trading/contracts';
import type { AnalysisDatasetDoc } from '@paper-trading/analysis';

function doc(over: Partial<AnalysisDatasetDoc> = {}): AnalysisDatasetDoc {
  return {
    kind: PaperTradingKind.ANALYSIS_DATASET,
    id: 'ds-2',
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    origin: 'replay',
    status: 'ready',
    rowCount: 5,
    symbolScope: ['MSFT'],
    signalTypes: [],
    exitRule: 'trailing-8',
    barRange: { from: '2023-01-01', to: '2026-10-16' },
    entryConvention: 'signal-bar-close',
    generatedAt: '2026-10-20T12:00:00Z',
    gcsPath: 'analysis-datasets/ds-2.csv',
    tags: [],
    ...over,
  };
}

describe('WorkbenchToolsComponent', () => {
  let fixture: ComponentFixture<WorkbenchToolsComponent>;
  let component: WorkbenchToolsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkbenchToolsComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(WorkbenchToolsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('canSave', true);
    fixture.componentRef.setInput('slices', []);
    fixture.componentRef.setInput('skippedSliceColumns', []);
    fixture.componentRef.setInput('skippedCompareColumns', []);
    fixture.componentRef.setInput('compareOptions', []);
    fixture.componentRef.setInput('compareDataset', null);
    fixture.componentRef.setInput('isLoadingCompare', false);
    fixture.componentRef.setInput('labelFor', (d: AnalysisDatasetDoc) => d.id);
    fixture.detectChanges();
  });

  function el(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function clickFormBtn(label: string): void {
    const btns = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.save-slice-form .tool-btn'),
    ) as HTMLButtonElement[];
    btns.find((b) => b.textContent?.trim() === label)!.click();
  }

  it('emits saved with name + trimmed note, then resets the form', () => {
    const spy = jest.fn();
    component.saved.subscribe(spy);
    (el('.tool-btn') as HTMLButtonElement).click(); // opens the form
    fixture.detectChanges();
    (el('.slice-name') as HTMLInputElement).value = 'V2 longs';
    el('.slice-name')!.dispatchEvent(new Event('input'));
    (el('.slice-note-input') as HTMLInputElement).value = '  first pass ';
    el('.slice-note-input')!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickFormBtn('Save');
    expect(spy).toHaveBeenCalledWith({ name: 'V2 longs', note: 'first pass' });
    fixture.detectChanges();
    // form closed AND draft cleared — reopening shows empty inputs
    expect(el('.save-slice-form')).toBeNull();
    (el('.tool-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((el('.slice-name') as HTMLInputElement).value).toBe('');
    expect((el('.slice-note-input') as HTMLInputElement).value).toBe('');
  });

  it('cancel drops the draft — reopening starts empty', () => {
    (el('.tool-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el('.slice-name') as HTMLInputElement).value = 'abandoned';
    el('.slice-name')!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickFormBtn('Cancel');
    fixture.detectChanges();
    (el('.tool-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((el('.slice-name') as HTMLInputElement).value).toBe('');
  });

  it('Save slice is disabled when canSave is false (empty filter chain)', () => {
    fixture.componentRef.setInput('canSave', false);
    fixture.detectChanges();
    expect((el('.tool-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders the skipped-slice-columns notice', () => {
    fixture.componentRef.setInput('skippedSliceColumns', ['ind.zoneV2', 'ind.zoneV2Prev']);
    fixture.detectChanges();
    expect(el('.skip-note')?.textContent).toContain('slice skipped columns');
    expect(el('.skip-note')?.textContent).toContain('ind.zoneV2');
  });

  it('renders the compare-skip notice', () => {
    // Gating on an active compare lives upstream — the store's
    // skippedCompareColumns returns [] whenever compareColumns is
    // empty; the component just renders what it's handed.
    fixture.componentRef.setInput('skippedCompareColumns', ['direction']);
    fixture.detectChanges();
    const note = el('.skip-note');
    expect(note?.textContent).toContain('compare skipped columns');
    expect(note?.textContent).toContain('direction');
  });

  it('compare chip forwards ✕ to compareCleared', () => {
    const spy = jest.fn();
    component.compareCleared.subscribe(spy);
    fixture.componentRef.setInput('compareDataset', doc());
    fixture.detectChanges();
    expect(el('.compare-chip')?.textContent).toContain('ds-2');
    expect(el('.compare-select')).toBeNull();
    (el('.chip-x') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
  });
});
