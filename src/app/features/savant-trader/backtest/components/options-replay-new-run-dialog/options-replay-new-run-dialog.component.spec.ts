import { TestBed } from '@angular/core/testing';
import { DsDialogRef } from '../../../../../shared/ds/ds-dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OptionsReplayNewRunDialogComponent } from './options-replay-new-run-dialog.component';
import { REPLAY_TEMPLATES } from '@options-replay/templates';

describe('OptionsReplayNewRunDialogComponent', () => {
  let dialogRef: { close: jest.Mock };

  async function setup() {
    dialogRef = { close: jest.fn() };

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DsDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionsReplayNewRunDialogComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  it('binds the template dropdown to REPLAY_TEMPLATES (name + description)', async () => {
    const { component } = await setup();
    expect(component.templates).toBe(REPLAY_TEMPLATES);
    expect(component.templates.length).toBeGreaterThan(0);
    expect(component.form.controls.templateId.value).toBe(REPLAY_TEMPLATES[0].id);
  });

  it('renders each template with name + description', async () => {
    const { fixture } = await setup();
    // Open the mat-select panel
    const select = fixture.nativeElement.querySelector('select[formControlName="templateId"]') as HTMLSelectElement;
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(REPLAY_TEMPLATES.length);
    for (const t of REPLAY_TEMPLATES) {
      const opt = Array.from(options).find((o) => o.textContent?.includes(t.name));
      expect(opt).toBeTruthy();
      expect(opt?.textContent).toContain(t.description);
    }
  });

  it('submit emits the correct OptionsReplayStartRequest payload', async () => {
    const { component } = await setup();
    component.form.setValue({
      templateId: 'csp-30-30',
      symbolsText: 'spy, qqq  amat',
      startYear: 2026,
      startMonth: 1,
      startDay: 5,
    });

    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      templateId: 'csp-30-30',
      symbols: ['SPY', 'QQQ', 'AMAT'],
      startDate: '2026-01-05',
    });
  });

  it('defaults the start date to 2026-01-01 (earliest grid coverage)', async () => {
    const { component } = await setup();

    expect(component.form.controls.startYear.value).toBe(2026);
    expect(component.form.controls.startMonth.value).toBe(1);
    expect(component.form.controls.startDay.value).toBe(1);
  });

  it('emits a zero-padded YYYY-MM-DD startDate from the Y/M/D selects', async () => {
    const { component } = await setup();
    component.form.patchValue({ startYear: 2025, startMonth: 3, startDay: 7 });

    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2025-03-07' }),
    );
  });

  it('day dropdown tracks the month length — Feb 2026 offers 28 days', async () => {
    const { component } = await setup();
    component.form.patchValue({ startYear: 2026, startMonth: 2 });

    expect(component.dayOptions()).toHaveLength(28);
  });

  it('day dropdown honors leap years — Feb 2024 offers 29 days', async () => {
    const { component } = await setup();
    component.form.patchValue({ startYear: 2024, startMonth: 2 });

    expect(component.dayOptions()).toHaveLength(29);
  });

  it('clamps the day when the month shrinks — Jan 31 → Feb → 28', async () => {
    const { component } = await setup();
    component.form.setValue({
      templateId: 'csp-45-20',
      symbolsText: 'QQQ',
      startYear: 2026,
      startMonth: 1,
      startDay: 31,
    });

    component.form.controls.startMonth.setValue(2);

    expect(component.form.controls.startDay.value).toBe(28);
  });

  it('clamps the day when the year loses a leap day — Feb 29 2024 → 2025 → 28', async () => {
    const { component } = await setup();
    component.form.setValue({
      templateId: 'csp-45-20',
      symbolsText: 'QQQ',
      startYear: 2024,
      startMonth: 2,
      startDay: 29,
    });

    component.form.controls.startYear.setValue(2025);

    expect(component.form.controls.startDay.value).toBe(28);
  });

  it('clamps even on a programmatic setValue — {month: 2, day: 31} cannot persist Feb 31', async () => {
    const { component } = await setup();
    component.form.setValue({
      templateId: 'csp-45-20',
      symbolsText: 'QQQ',
      startYear: 2026,
      startMonth: 2,
      startDay: 31,
    });

    expect(component.form.controls.startDay.value).toBe(28);
  });

  it('floors the year select at 2026 — no dead picks before grid coverage', async () => {
    const { component } = await setup();

    expect(component.years).toContain(2026);
    expect(Math.min(...component.years)).toBe(2026);
  });

  it('does not close when symbols parse to nothing', async () => {
    const { component } = await setup();
    component.form.setValue({
      templateId: 'csp-45-20',
      symbolsText: ' , , ',
      startYear: 2026,
      startMonth: 1,
      startDay: 5,
    });
    // symbolsText passes `required` (non-empty string) but parses to zero
    component.form.controls.symbolsText.markAsTouched();
    component.submit();
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.form.controls.symbolsText.hasError('required')).toBe(true);
  });

  it('cancel closes with undefined', async () => {
    const { component } = await setup();
    component.cancel();
    expect(dialogRef.close).toHaveBeenCalledWith(undefined);
  });
});
