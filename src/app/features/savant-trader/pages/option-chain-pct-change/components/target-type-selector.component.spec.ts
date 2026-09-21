import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { By } from '@angular/platform-browser';

import { TargetTypeSelectorComponent } from './target-type-selector.component';
import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';
import type { TargetType, PctMode, UserDatesMode, PctDirection } from '@shared/pct-change-config-contracts';

/**
 * Mock store — state as writable signals, methods as jest.fn()s that patch
 * the same signals the real store would. This keeps UI tests honest: a
 * click both calls the store AND re-renders from store state, like prod.
 */
function makeMockStore() {
  const state = {
    targetType: signal<TargetType>('pct-change'),
    pctMode: signal<PctMode>('list'),
    pctValues: signal<number[]>([]),
    pctStep: signal(5),
    pctCount: signal(4),
    pctDirection: signal<PctDirection>('up'),
    userDatesMode: signal<UserDatesMode>('manual'),
    intervalCount: signal(5),
    intervalDays: signal(5),
    startDate: signal('2025-04-07'),
    targetDates: signal<string[]>([]),
  };
  return {
    ...state,
    setTargetType: jest.fn((t: TargetType): void => { state.targetType.set(t); }),
    setPctMode: jest.fn((m: PctMode): void => { state.pctMode.set(m); }),
    setPctParams: jest.fn((values: number[], step: number, count: number, direction: PctDirection): void => {
      state.pctValues.set(values);
      state.pctStep.set(step);
      state.pctCount.set(count);
      state.pctDirection.set(direction);
    }),
    setUserDatesMode: jest.fn((m: UserDatesMode): void => { state.userDatesMode.set(m); }),
    setIntervalParams: jest.fn((count: number, days: number): void => {
      state.intervalCount.set(count);
      state.intervalDays.set(days);
    }),
    setTargetDates: jest.fn((d: string[]): void => { state.targetDates.set(d); }),
    resolvePctChangeTargets: jest.fn(),
  };
}

describe('TargetTypeSelectorComponent', () => {
  let fixture: ComponentFixture<TargetTypeSelectorComponent>;
  let store: ReturnType<typeof makeMockStore>;

  beforeEach(() => {
    store = makeMockStore();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: OptionChainPctChangeStore, useValue: store },
      ],
      imports: [TargetTypeSelectorComponent],
    });
    fixture = TestBed.createComponent(TargetTypeSelectorComponent);
    fixture.detectChanges();
  });

  // -------------------------------------------------------------------------
  // Segmented button group
  // -------------------------------------------------------------------------

  describe('segmented button group', () => {
    it('renders two target type buttons', () => {
      const buttons = fixture.debugElement.queryAll(By.css('[data-testid^="target-type-btn-"]'));
      expect(buttons.length).toBe(2);
      const labels = buttons.map(b => b.nativeElement.textContent.trim());
      expect(labels).toEqual(['Pct Change', 'User Dates']);
    });

    it('defaults to pct-change target type', () => {
      expect(store.targetType()).toBe('pct-change');
    });

    it('calls store.setTargetType when a button is clicked', () => {
      const buttons = fixture.debugElement.queryAll(By.css('[data-testid^="target-type-btn-"]'));
      buttons[1].nativeElement.click(); // User Dates
      fixture.detectChanges();
      expect(store.setTargetType).toHaveBeenCalledWith('user-dates');
      expect(store.targetType()).toBe('user-dates');
    });

    it('marks the active button', () => {
      const buttons = fixture.debugElement.queryAll(By.css('[data-testid^="target-type-btn-"]'));
      expect(buttons[0].nativeElement.classList.contains('active')).toBe(true);
      buttons[1].nativeElement.click(); // User Dates
      fixture.detectChanges();
      const updated = fixture.debugElement.queryAll(By.css('[data-testid^="target-type-btn-"]'));
      expect(updated[1].nativeElement.classList.contains('active')).toBe(true);
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
      expect(store.pctMode()).toBe('list');
    });

    it('switches to gradation mode via the store', () => {
      const gradationBtn = fixture.debugElement.query(By.css('[data-testid="pct-mode-gradation"]'));
      gradationBtn.nativeElement.click();
      fixture.detectChanges();
      expect(store.setPctMode).toHaveBeenCalledWith('gradation');
      expect(store.pctMode()).toBe('gradation');
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

    it('calls resolvePctChangeTargets with parsed list values when Resolve is clicked', () => {
      const input = fixture.debugElement.query(By.css('[data-testid="pct-values-input"]'));
      input.nativeElement.value = '-3, 5, 10';
      input.nativeElement.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      const resolveBtn = fixture.debugElement.query(By.css('[data-testid="pct-resolve-btn"]'));
      resolveBtn.nativeElement.click();
      fixture.detectChanges();
      expect(store.resolvePctChangeTargets).toHaveBeenCalledWith({
        mode: 'list',
        values: [-3, 5, 10],
      });
    });

    it('calls resolvePctChangeTargets with gradation params in gradation mode', () => {
      const gradationBtn = fixture.debugElement.query(By.css('[data-testid="pct-mode-gradation"]'));
      gradationBtn.nativeElement.click();
      fixture.detectChanges();
      const resolveBtn = fixture.debugElement.query(By.css('[data-testid="pct-resolve-btn"]'));
      resolveBtn.nativeElement.click();
      fixture.detectChanges();
      expect(store.resolvePctChangeTargets).toHaveBeenCalledWith({
        mode: 'gradation',
        values: [],
        step: 5,
        count: 4,
        direction: 'up',
      });
    });

    it('resolves with empty values so the store can surface an error', () => {
      const input = fixture.debugElement.query(By.css('[data-testid="pct-values-input"]'));
      input.nativeElement.value = '';
      input.nativeElement.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      const resolveBtn = fixture.debugElement.query(By.css('[data-testid="pct-resolve-btn"]'));
      resolveBtn.nativeElement.click();
      fixture.detectChanges();
      expect(store.resolvePctChangeTargets).toHaveBeenCalledWith({
        mode: 'list',
        values: [],
      });
    });

    it('pushes pct params to the store when inputs change', () => {
      const input = fixture.debugElement.query(By.css('[data-testid="pct-values-input"]'));
      input.nativeElement.value = '2, 4';
      input.nativeElement.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(store.setPctParams).toHaveBeenCalledWith([2, 4], 5, 4, 'up');
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
      expect(store.userDatesMode()).toBe('manual');
    });

    it('shows manual date input + Add button in manual mode', () => {
      expect(fixture.debugElement.query(By.css('[data-testid="manual-date-input"]'))).toBeTruthy();
      expect(fixture.debugElement.query(By.css('[data-testid="manual-add-btn"]'))).toBeTruthy();
    });

    it('calls setTargetDates when a manual date is added', () => {
      const input = fixture.debugElement.query(By.css('[data-testid="manual-date-input"]'));
      input.nativeElement.value = '2025-04-15';
      const addBtn = fixture.debugElement.query(By.css('[data-testid="manual-add-btn"]'));
      addBtn.nativeElement.click();
      fixture.detectChanges();
      expect(store.setTargetDates).toHaveBeenCalledWith(['2025-04-15']);
    });

    it('does not call setTargetDates when manual date is empty', () => {
      const addBtn = fixture.debugElement.query(By.css('[data-testid="manual-add-btn"]'));
      addBtn.nativeElement.click();
      fixture.detectChanges();
      expect(store.setTargetDates).not.toHaveBeenCalled();
    });

    it('shows interval inputs when Interval is selected', () => {
      const intervalBtn = fixture.debugElement.query(By.css('[data-testid="user-dates-mode-interval"]'));
      intervalBtn.nativeElement.click();
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('[data-testid="interval-count-input"]'))).toBeTruthy();
      expect(fixture.debugElement.query(By.css('[data-testid="interval-days-input"]'))).toBeTruthy();
      expect(fixture.debugElement.query(By.css('[data-testid="interval-generate-btn"]'))).toBeTruthy();
    });

    it('calls setTargetDates with generated interval dates when Generate is clicked', () => {
      const intervalBtn = fixture.debugElement.query(By.css('[data-testid="user-dates-mode-interval"]'));
      intervalBtn.nativeElement.click();
      fixture.detectChanges();
      const generateBtn = fixture.debugElement.query(By.css('[data-testid="interval-generate-btn"]'));
      generateBtn.nativeElement.click();
      fixture.detectChanges();
      // startDate is 2025-04-07, count 5, days 5
      const dates = store.setTargetDates.mock.calls[0][0] as string[];
      expect(dates.length).toBe(5);
      expect(dates[0]).toBe('2025-04-07');
      expect(dates[1]).toBe('2025-04-12');
    });

    it('does not generate when startDate is empty in interval mode', () => {
      store.startDate.set('');
      fixture.detectChanges();
      const intervalBtn = fixture.debugElement.query(By.css('[data-testid="user-dates-mode-interval"]'));
      intervalBtn.nativeElement.click();
      fixture.detectChanges();
      const generateBtn = fixture.debugElement.query(By.css('[data-testid="interval-generate-btn"]'));
      generateBtn.nativeElement.click();
      fixture.detectChanges();
      expect(store.setTargetDates).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Editable target dates
  // -------------------------------------------------------------------------

  describe('editable target dates', () => {
    it('renders the current target dates as editable inputs', () => {
      store.targetDates.set(['2025-04-10', '2025-04-15']);
      fixture.detectChanges();
      const dateInputs = fixture.debugElement.queryAll(By.css('[data-testid^="target-date-input-"]'));
      expect(dateInputs.length).toBe(2);
    });

    it('calls setTargetDates when a date is edited', () => {
      store.targetDates.set(['2025-04-10']);
      fixture.detectChanges();
      const input = fixture.debugElement.query(By.css('[data-testid="target-date-input-0"]'));
      input.nativeElement.value = '2025-04-12';
      input.nativeElement.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(store.setTargetDates).toHaveBeenCalledWith(['2025-04-12']);
    });

    it('allows removing a target date', () => {
      store.targetDates.set(['2025-04-10', '2025-04-15']);
      fixture.detectChanges();
      const removeBtn = fixture.debugElement.query(By.css('[data-testid="remove-target-date-0"]'));
      removeBtn.nativeElement.click();
      fixture.detectChanges();
      expect(store.setTargetDates).toHaveBeenCalledWith(['2025-04-15']);
    });

    it('clears all target dates via Clear All', () => {
      store.targetDates.set(['2025-04-10', '2025-04-15']);
      fixture.detectChanges();
      const clearBtn = fixture.debugElement.query(By.css('[data-testid="clear-target-dates"]'));
      expect(clearBtn).not.toBeNull();
      clearBtn.nativeElement.click();
      fixture.detectChanges();
      expect(store.setTargetDates).toHaveBeenCalledWith([]);
      // The list — including the Clear All button — disappears.
      expect(fixture.debugElement.query(By.css('[data-testid="clear-target-dates"]'))).toBeNull();
      expect(fixture.debugElement.queryAll(By.css('[data-testid^="target-date-input-"]')).length).toBe(0);
    });
  });
});
