import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';

import { TargetTypeSelectorComponent, ResolvePctChangeRequest } from './target-type-selector.component';
import type { TargetType } from '@shared/pct-change-config-contracts';

describe('TargetTypeSelectorComponent', () => {
  let fixture: ComponentFixture<TargetTypeSelectorComponent>;
  let component: TargetTypeSelectorComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
      imports: [TargetTypeSelectorComponent],
    });
    fixture = TestBed.createComponent(TargetTypeSelectorComponent);
    component = fixture.componentInstance;
    component.startDate = '2025-04-07';
    fixture.detectChanges();
  });

  // -------------------------------------------------------------------------
  // Segmented button group
  // -------------------------------------------------------------------------

  describe('segmented button group', () => {
    it('renders three target type buttons', () => {
      const buttons = fixture.debugElement.queryAll(By.css('[data-testid^="target-type-btn-"]'));
      expect(buttons.length).toBe(3);
      const labels = buttons.map(b => b.nativeElement.textContent.trim());
      expect(labels).toEqual(['Pct Change', 'Swing Extremes', 'User Dates']);
    });

    it('defaults to pct-change target type', () => {
      expect(component.targetTypeSig()).toBe('pct-change');
    });

    it('emits targetTypeChange when a button is clicked', () => {
      const emitted: TargetType[] = [];
      component.targetTypeChange.subscribe((t: TargetType) => emitted.push(t));
      const buttons = fixture.debugElement.queryAll(By.css('[data-testid^="target-type-btn-"]'));
      buttons[1].nativeElement.click(); // Swing Extremes
      fixture.detectChanges();
      expect(emitted).toEqual(['swing-extremes']);
      expect(component.targetTypeSig()).toBe('swing-extremes');
    });

    it('marks the active button', () => {
      const buttons = fixture.debugElement.queryAll(By.css('[data-testid^="target-type-btn-"]'));
      expect(buttons[0].nativeElement.classList.contains('active')).toBe(true);
      buttons[2].nativeElement.click(); // User Dates
      fixture.detectChanges();
      const updated = fixture.debugElement.queryAll(By.css('[data-testid^="target-type-btn-"]'));
      expect(updated[2].nativeElement.classList.contains('active')).toBe(true);
      expect(updated[0].nativeElement.classList.contains('active')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Pct Change mode
  // -------------------------------------------------------------------------

  describe('pct-change mode', () => {
    it('shows List/Gradation toggle', () => {
      const toggle = fixture.debugElement.query(By.css('[data-testid="pct-mode-toggle"]'));
      expect(toggle).toBeTruthy();
    });

    it('defaults to list mode', () => {
      expect(component.pctModeSig()).toBe('list');
    });

    it('switches to gradation mode', () => {
      const gradationBtn = fixture.debugElement.query(By.css('[data-testid="pct-mode-gradation"]'));
      gradationBtn.nativeElement.click();
      fixture.detectChanges();
      expect(component.pctModeSig()).toBe('gradation');
    });

    it('shows pct values input in list mode', () => {
      const input = fixture.debugElement.query(By.css('[data-testid="pct-values-input"]'));
      expect(input).toBeTruthy();
    });

    it('shows step, count, direction inputs in gradation mode', () => {
      const gradationBtn = fixture.debugElement.query(By.css('[data-testid="pct-mode-gradation"]'));
      gradationBtn.nativeElement.click();
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('[data-testid="pct-step-input"]'))).toBeTruthy();
      expect(fixture.debugElement.query(By.css('[data-testid="pct-count-input"]'))).toBeTruthy();
      expect(fixture.debugElement.query(By.css('[data-testid="pct-direction-input"]'))).toBeTruthy();
    });

    it('emits resolvePctChangeRequest with parsed list values when Resolve is clicked', () => {
      const emitted: ResolvePctChangeRequest[] = [];
      component.resolvePctChangeRequest.subscribe((r: ResolvePctChangeRequest) => emitted.push(r));
      // Set a known pct values string
      const input = fixture.debugElement.query(By.css('[data-testid="pct-values-input"]'));
      input.nativeElement.value = '-3, 5, 10';
      input.nativeElement.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      const resolveBtn = fixture.debugElement.query(By.css('[data-testid="pct-resolve-btn"]'));
      resolveBtn.nativeElement.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(1);
      expect(emitted[0].mode).toBe('list');
      expect(emitted[0].values).toEqual([-3, 5, 10]);
    });

    it('emits resolvePctChangeRequest with gradation params when Resolve is clicked in gradation mode', () => {
      const emitted: ResolvePctChangeRequest[] = [];
      component.resolvePctChangeRequest.subscribe((r: ResolvePctChangeRequest) => emitted.push(r));
      const gradationBtn = fixture.debugElement.query(By.css('[data-testid="pct-mode-gradation"]'));
      gradationBtn.nativeElement.click();
      fixture.detectChanges();
      const resolveBtn = fixture.debugElement.query(By.css('[data-testid="pct-resolve-btn"]'));
      resolveBtn.nativeElement.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(1);
      expect(emitted[0].mode).toBe('gradation');
      expect(emitted[0].step).toBe(5);
      expect(emitted[0].count).toBe(4);
      expect(emitted[0].direction).toBe('up');
    });

    it('does not emit when pct values are empty in list mode', () => {
      const emitted: ResolvePctChangeRequest[] = [];
      component.resolvePctChangeRequest.subscribe((r: ResolvePctChangeRequest) => emitted.push(r));
      const input = fixture.debugElement.query(By.css('[data-testid="pct-values-input"]'));
      input.nativeElement.value = '';
      input.nativeElement.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      const resolveBtn = fixture.debugElement.query(By.css('[data-testid="pct-resolve-btn"]'));
      resolveBtn.nativeElement.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Swing Extremes mode
  // -------------------------------------------------------------------------

  describe('swing-extremes mode', () => {
    beforeEach(() => {
      const swingBtn = fixture.debugElement.query(By.css('[data-testid="target-type-btn-swing-extremes"]'));
      swingBtn.nativeElement.click();
      fixture.detectChanges();
    });

    it('shows "Coming soon" message', () => {
      const msg = fixture.debugElement.query(By.css('[data-testid="swing-coming-soon"]'));
      expect(msg).toBeTruthy();
      expect(msg.nativeElement.textContent).toContain('Coming soon');
    });

    it('renders disabled count, deviation, depth, backstep inputs', () => {
      expect(fixture.debugElement.query(By.css('[data-testid="swing-count-input"]'))).toBeTruthy();
      expect(fixture.debugElement.query(By.css('[data-testid="swing-deviation-input"]'))).toBeTruthy();
      expect(fixture.debugElement.query(By.css('[data-testid="swing-depth-input"]'))).toBeTruthy();
      expect(fixture.debugElement.query(By.css('[data-testid="swing-backstep-input"]'))).toBeTruthy();
      const countInput = fixture.debugElement.query(By.css('[data-testid="swing-count-input"]')).nativeElement;
      expect(countInput.disabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // User Dates mode
  // -------------------------------------------------------------------------

  describe('user-dates mode', () => {
    beforeEach(() => {
      const userBtn = fixture.debugElement.query(By.css('[data-testid="target-type-btn-user-dates"]'));
      userBtn.nativeElement.click();
      fixture.detectChanges();
    });

    it('shows Manual/Interval toggle', () => {
      const toggle = fixture.debugElement.query(By.css('[data-testid="user-dates-mode-toggle"]'));
      expect(toggle).toBeTruthy();
    });

    it('defaults to manual mode', () => {
      expect(component.userDatesModeSig()).toBe('manual');
    });

    it('shows manual date input + Add button in manual mode', () => {
      expect(fixture.debugElement.query(By.css('[data-testid="manual-date-input"]'))).toBeTruthy();
      expect(fixture.debugElement.query(By.css('[data-testid="manual-add-btn"]'))).toBeTruthy();
    });

    it('emits targetDatesChange when a manual date is added', () => {
      const emitted: string[][] = [];
      component.targetDatesChange.subscribe((d: string[]) => emitted.push(d));
      const input = fixture.debugElement.query(By.css('[data-testid="manual-date-input"]'));
      input.nativeElement.value = '2025-04-15';
      const addBtn = fixture.debugElement.query(By.css('[data-testid="manual-add-btn"]'));
      addBtn.nativeElement.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(1);
      expect(emitted[0]).toEqual(['2025-04-15']);
    });

    it('does not emit when manual date is empty', () => {
      const emitted: string[][] = [];
      component.targetDatesChange.subscribe((d: string[]) => emitted.push(d));
      const addBtn = fixture.debugElement.query(By.css('[data-testid="manual-add-btn"]'));
      addBtn.nativeElement.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(0);
    });

    it('shows interval inputs when Interval is selected', () => {
      const intervalBtn = fixture.debugElement.query(By.css('[data-testid="user-dates-mode-interval"]'));
      intervalBtn.nativeElement.click();
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('[data-testid="interval-count-input"]'))).toBeTruthy();
      expect(fixture.debugElement.query(By.css('[data-testid="interval-days-input"]'))).toBeTruthy();
      expect(fixture.debugElement.query(By.css('[data-testid="interval-generate-btn"]'))).toBeTruthy();
    });

    it('emits targetDatesChange with generated interval dates when Generate is clicked', () => {
      const emitted: string[][] = [];
      component.targetDatesChange.subscribe((d: string[]) => emitted.push(d));
      const intervalBtn = fixture.debugElement.query(By.css('[data-testid="user-dates-mode-interval"]'));
      intervalBtn.nativeElement.click();
      fixture.detectChanges();
      const generateBtn = fixture.debugElement.query(By.css('[data-testid="interval-generate-btn"]'));
      generateBtn.nativeElement.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(1);
      // startDate is 2025-04-07, count 5, days 5
      expect(emitted[0].length).toBe(5);
      expect(emitted[0][0]).toBe('2025-04-07');
      expect(emitted[0][1]).toBe('2025-04-12');
    });

    it('does not emit when startDate is empty in interval mode', () => {
      component.startDate = '';
      fixture.detectChanges();
      const intervalBtn = fixture.debugElement.query(By.css('[data-testid="user-dates-mode-interval"]'));
      intervalBtn.nativeElement.click();
      fixture.detectChanges();
      const emitted: string[][] = [];
      component.targetDatesChange.subscribe((d: string[]) => emitted.push(d));
      const generateBtn = fixture.debugElement.query(By.css('[data-testid="interval-generate-btn"]'));
      generateBtn.nativeElement.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Editable target dates
  // -------------------------------------------------------------------------

  describe('editable target dates', () => {
    it('renders the current target dates as editable inputs', () => {
      fixture.componentRef.setInput('targetDates', ['2025-04-10', '2025-04-15']);
      fixture.detectChanges();
      const dateInputs = fixture.debugElement.queryAll(By.css('[data-testid^="target-date-input-"]'));
      expect(dateInputs.length).toBe(2);
    });

    it('emits targetDatesChange when a date is edited', () => {
      const emitted: string[][] = [];
      component.targetDatesChange.subscribe((d: string[]) => emitted.push(d));
      fixture.componentRef.setInput('targetDates', ['2025-04-10']);
      fixture.detectChanges();
      const input = fixture.debugElement.query(By.css('[data-testid="target-date-input-0"]'));
      input.nativeElement.value = '2025-04-12';
      input.nativeElement.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(emitted.length).toBe(1);
      expect(emitted[0]).toEqual(['2025-04-12']);
    });

    it('allows removing a target date', () => {
      const emitted: string[][] = [];
      component.targetDatesChange.subscribe((d: string[]) => emitted.push(d));
      fixture.componentRef.setInput('targetDates', ['2025-04-10', '2025-04-15']);
      fixture.detectChanges();
      const removeBtn = fixture.debugElement.query(By.css('[data-testid="remove-target-date-0"]'));
      removeBtn.nativeElement.click();
      fixture.detectChanges();
      expect(emitted[0]).toEqual(['2025-04-15']);
    });
  });
});
