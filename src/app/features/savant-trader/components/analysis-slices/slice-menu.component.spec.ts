/**
 * SliceMenuComponent spec (#1085) — saved-slice list: apply on click,
 * per-item delete, empty state, and the canApply=false manage-only mode
 * used by the library (no dataset open → nothing to filter).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AnalysisSlice } from '@paper-trading/analysis';
import { PaperTradingKind } from '@paper-trading/contracts';
import { SliceMenuComponent } from './slice-menu.component';

function slice(id: string, name: string, n = 1, note?: string): AnalysisSlice {
  return {
    id,
    kind: PaperTradingKind.ANALYSIS_SLICE,
    name,
    note,
    createdAt: '2026-10-21T00:00:00Z',
    updatedAt: '2026-10-21T00:00:00Z',
    filters: Array.from({ length: n }, (_, i) => ({
      column: 'symbol',
      op: 'in' as const,
      value: [`S${i}`],
    })),
  };
}

describe('SliceMenuComponent', () => {
  let fixture: ComponentFixture<SliceMenuComponent>;
  let component: SliceMenuComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SliceMenuComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SliceMenuComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('slices', []);
    fixture.detectChanges();
  });

  // The ds-menu dropdown renders inside the component DOM (no CDK
  // overlay) — query the fixture element, not document.
  function el<T extends Element>(sel: string): T | null {
    return fixture.nativeElement.querySelector(sel);
  }

  function openMenu(): void {
    el<HTMLButtonElement>('.slice-btn')!.click();
    fixture.detectChanges();
  }

  it('shows an empty-state when no slices exist', () => {
    openMenu();
    expect(el('.slice-empty')?.textContent).toContain('No saved slices');
  });

  it('lists each slice with its filter count', () => {
    fixture.componentRef.setInput('slices', [
      slice('s1', 'Long winners', 3, 'only longs'),
      slice('s2', 'ZoneV2=4'),
    ]);
    openMenu();
    const items = fixture.nativeElement.querySelectorAll('.slice-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Long winners');
    expect(items[0].textContent).toContain('3');
    expect(items[0].textContent).toContain('only longs');
  });

  it('emits applied with the slice on click', () => {
    const s = slice('s1', 'Longs');
    fixture.componentRef.setInput('slices', [s]);
    const spy = jest.fn();
    component.applied.subscribe(spy);
    openMenu();
    el<HTMLButtonElement>('.slice-item .slice-apply')!.click();
    expect(spy).toHaveBeenCalledWith(s);
  });

  it('emits deleted with the slice id', () => {
    fixture.componentRef.setInput('slices', [slice('s1', 'Longs')]);
    const spy = jest.fn();
    component.deleted.subscribe(spy);
    openMenu();
    el<HTMLButtonElement>('.slice-item .slice-delete')!.click();
    expect(spy).toHaveBeenCalledWith('s1');
  });

  it('canApply=false renders names without an apply control (library manage mode)', () => {
    fixture.componentRef.setInput('slices', [slice('s1', 'Longs')]);
    fixture.componentRef.setInput('canApply', false);
    openMenu();
    expect(el('.slice-item .slice-apply')).toBeNull();
    expect(el('.slice-item .slice-name')?.textContent).toContain('Longs');
    expect(el('.slice-item .slice-delete')).not.toBeNull();
  });
});
