import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';

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
        { provide: MatDialogRef, useValue: dialogRef },
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
    const select: HTMLElement = fixture.nativeElement.querySelector('mat-select');
    select.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const options = document.querySelectorAll('mat-option');
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
      startDate: '2026-01-05',
    });

    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      templateId: 'csp-30-30',
      symbols: ['SPY', 'QQQ', 'AMAT'],
      startDate: '2026-01-05',
    });
  });

  it('rejects an impossible date (2026-02-30)', async () => {
    const { component } = await setup();
    // Native date inputs reject impossible dates before the control sees
    // them — drive the validator directly for coverage.
    component.form.controls.startDate.setValue('2026-02-30');
    expect(component.form.controls.startDate.hasError('marketDate')).toBe(true);
  });

  it('rejects a malformed date string', async () => {
    const { component } = await setup();
    component.form.controls.startDate.setValue('not-a-date');
    expect(component.form.controls.startDate.hasError('marketDate')).toBe(true);
  });

  it('does not close when symbols parse to nothing', async () => {
    const { component } = await setup();
    component.form.setValue({
      templateId: 'csp-45-20',
      symbolsText: ' , , ',
      startDate: '2026-01-05',
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
