/**
 * @topic #1098 — RH Scanner | @task #1141
 * ScannerComparePanelComponent — bucket expandos (per non-empty bucket,
 * counts on the header), symbol chips → focusSymbol emit, dropDetail
 * tooltips, read-only proposal mode (title/meta/close).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import {
  ScannerComparePanelComponent,
  type ComparePanelData,
} from './scanner-compare-panel.component';

function data(over: Partial<ComparePanelData> = {}): ComparePanelData {
  return {
    addCandidates: ['NEWCO'],
    dropCandidates: ['DROP1'],
    deadSymbols: [],
    noDataSymbols: ['BLANK1'],
    ...over,
  };
}

describe('ScannerComparePanelComponent', () => {
  let fixture: ComponentFixture<ScannerComparePanelComponent>;
  let component: ScannerComparePanelComponent;

  function el(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function els(selector: string): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll(selector)];
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScannerComparePanelComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(ScannerComparePanelComponent);
    component = fixture.componentInstance;
  });

  it('renders a section per non-empty bucket with counts; empty buckets hidden', () => {
    fixture.componentRef.setInput('data', data());
    fixture.detectChanges();
    const heads = els('.bucket-head');
    expect(heads.length).toBe(3); // add, drop, nodata — dead is empty
    expect(heads[0].textContent).toContain('Add');
    expect(heads[0].textContent).toContain('1');
    expect(els('.bucket-dead').length).toBe(0);
  });

  it('renders an Unevaluated section only when the live compare has one', () => {
    fixture.componentRef.setInput('data', data({ unevaluated: ['LOST'] }));
    fixture.detectChanges();
    const uneval = el('.bucket-uneval');
    expect(uneval?.textContent).toContain('Unevaluated');
    fixture.componentRef.setInput('data', data());
    fixture.detectChanges();
    expect(el('.bucket-uneval')).toBeNull();
  });

  it('chips are hidden until the section expands; click emits the symbol', () => {
    const spy = jest.fn();
    component.focusSymbol.subscribe(spy);
    fixture.componentRef.setInput('data', data());
    fixture.detectChanges();
    expect(els('.sym-chip').length).toBe(0);
    (els('.bucket-head')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    const chip = els('.sym-chip')[0] as HTMLButtonElement;
    chip.click();
    expect(spy).toHaveBeenCalledWith('NEWCO');
    // collapse on second click
    (els('.bucket-head')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(els('.sym-chip').length).toBe(0);
  });

  it('dropDetail surfaces as a chip tooltip', () => {
    fixture.componentRef.setInput(
      'data',
      data({ dropDetail: { DROP1: { ROE: '-0.4', NPM: '' } } }),
    );
    fixture.detectChanges();
    (els('.bucket-drop .bucket-head')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    const chip = el('.bucket-drop .sym-chip') as HTMLButtonElement;
    expect(chip.title).toContain('ROE: -0.4');
    expect(chip.title).toContain('NPM: —');
  });

  it('read-only mode renders title/meta + close; close emits', () => {
    const spy = jest.fn();
    component.closed.subscribe(spy);
    fixture.componentRef.setInput('data', data());
    fixture.componentRef.setInput('readOnly', true);
    fixture.componentRef.setInput('title', 'Quality — Mega Cap');
    fixture.componentRef.setInput('meta', 'universe 150 · 12 matched');
    fixture.detectChanges();
    expect(el('.panel-title')?.textContent).toContain('Quality — Mega Cap');
    expect(el('.read-only-tag')?.textContent).toContain('read-only');
    expect(el('.panel-meta')?.textContent).toContain('universe 150');
    (el('.close-btn') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
  });

  it('all-empty buckets render the all-clear line, not zero-count expandos', () => {
    fixture.componentRef.setInput(
      'data',
      data({
        addCandidates: [],
        dropCandidates: [],
        deadSymbols: [],
        noDataSymbols: [],
      }),
    );
    fixture.detectChanges();
    expect(el('.all-clear')?.textContent).toContain('No curation candidates');
    expect(els('.bucket-head').length).toBe(0);
  });

  it('renders nothing when data is null', () => {
    fixture.componentRef.setInput('data', null);
    fixture.detectChanges();
    expect(els('.bucket-head').length).toBe(0);
    expect(el('.all-clear')).toBeNull();
  });
});
