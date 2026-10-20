/**
 * AnalysisRunConfigComponent spec (Thread #1059, task #1082).
 *
 * AC3: invalid form input blocks submission before the callable fires —
 * `submitted` must never emit while the form is invalid (bad exit-rule
 * grammar, inverted bar range). Valid submits emit the callable-ready
 * AnalysisRunParams: replay carries the user's params; live carries the
 * fixed LIVE_DEFAULTS snapshot params + tags/notes meta.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { AnalysisRunConfigComponent } from './analysis-run-config.component';
import { SIGNAL_TYPES } from '@paper-trading/analysis';

describe('AnalysisRunConfigComponent', () => {
  let fixture: ComponentFixture<AnalysisRunConfigComponent>;
  let component: AnalysisRunConfigComponent;
  let emitted: unknown[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisRunConfigComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(AnalysisRunConfigComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.submitted.subscribe((s) => emitted.push(s));
    fixture.detectChanges();
  });

  // ── AC3: invalid input never reaches the callable ────────────────────

  it('blocks submit on invalid exit-rule grammar — nothing emitted', () => {
    component.form.controls.exitRule.setValue('not-a-rule');
    component.submit();
    expect(emitted).toEqual([]);
    expect(component.form.controls.exitRule.touched).toBe(true);
  });

  it('blocks submit on inverted bar range', () => {
    component.form.controls.barFrom.setValue(new Date(2026, 5, 1));
    component.form.controls.barTo.setValue(new Date(2025, 0, 1));
    component.submit();
    expect(emitted).toEqual([]);
    expect(component.form.hasError('barRange')).toBe(true);
  });

  it('a stale invalid exit rule cannot block a live snapshot — replay controls disable on origin switch', () => {
    component.form.controls.exitRule.setValue('bad');
    component.form.controls.origin.setValue('live');
    expect(component.form.controls.exitRule.disabled).toBe(true);
    component.submit();
    expect(emitted.length).toBe(1);
  });

  it('a stale inverted bar range cannot block a live snapshot — disabled controls skip the group validator', () => {
    component.form.controls.barFrom.setValue(new Date(2026, 5, 1));
    component.form.controls.barTo.setValue(new Date(2025, 0, 1));
    component.form.controls.origin.setValue('live');
    component.submit();
    expect(emitted.length).toBe(1);
  });

  // ── replay payload ───────────────────────────────────────────────────

  it('valid replay submit emits the callable-ready params', () => {
    component.form.patchValue({
      symbols: 'amat, NVDA ,amat',
      signalTypes: [SIGNAL_TYPES[0]],
      exitRule: 'time-30d',
      barFrom: new Date(2024, 0, 15),
      barTo: new Date(2026, 9, 20),
      tags: 'replay, oct',
      notes: 'thesis check',
    });
    component.submit();
    const s = emitted[0] as {
      params: Record<string, unknown>;
      meta: { tags: string[]; notes?: string };
    };
    expect(s.params).toEqual({
      origin: 'replay',
      symbolScope: ['AMAT', 'NVDA'],
      signalTypes: [SIGNAL_TYPES[0]],
      exitRule: 'time-30d',
      barRange: { from: '2024-01-15', to: '2026-10-20' },
      entryConvention: 'signal-bar-close',
    });
    expect(s.meta).toEqual({ tags: ['replay', 'oct'], notes: 'thesis check' });
  });

  it('empty symbols/signalTypes submit as empty arrays (all-in-scope per contract)', () => {
    component.submit();
    const s = emitted[0] as { params: { symbolScope: string[]; signalTypes: string[] } };
    expect(s.params.symbolScope).toEqual([]);
    expect(s.params.signalTypes).toEqual([]);
  });

  // ── live payload ─────────────────────────────────────────────────────

  it('live submit emits the fixed snapshot defaults, not form params', () => {
    component.form.patchValue({
      origin: 'live',
      exitRule: 'should-be-ignored', // disabled — never reaches params
      tags: 'live',
    });
    component.submit();
    const s = emitted[0] as {
      params: {
        origin: string;
        symbolScope: string[];
        signalTypes: string[];
        exitRule: string;
        barRange: { from: string; to: string };
        entryConvention: string;
      };
      meta: { tags: string[] };
    };
    expect(s.params.origin).toBe('live');
    expect(s.params.symbolScope).toEqual([]);
    expect(s.params.signalTypes).toEqual([]);
    expect(s.params.exitRule).toBe('trailing-8'); // provenance default, not the stale input
    expect(s.params.entryConvention).toBe('signal-bar-close');
    expect(s.params.barRange.from).toBe('2023-01-01');
    expect(s.params.barRange.to).toMatch(/^\d{4}-\d{2}-\d{2}$/); // today
    expect(s.meta.tags).toEqual(['live']);
  });

  // ── form behavior ────────────────────────────────────────────────────

  it('notes meta is omitted when blank', () => {
    component.submit();
    const s = emitted[0] as { meta: { notes?: string } };
    expect(s.meta.notes).toBeUndefined();
  });

  it('busy input disables the submit button', () => {
    component.busy = true;
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    );
    expect(btn.disabled).toBe(true);
  });

  it('cancel resets the form and emits cancelled', () => {
    let cancelCount = 0;
    component.cancelled.subscribe(() => cancelCount++);
    component.form.controls.symbols.setValue('AMAT');
    component.cancel();
    expect(cancelCount).toBe(1);
    expect(component.form.controls.symbols.value).toBe('');
  });
});
