/**
 * BacktestRunControlComponent specs (#1476).
 *
 * Filter/sort toolbar for the backtest run list. Pins the DS-primitive
 * markup (#1476 dedup): pills render as .dse-chip, text inputs as
 * .dse-input.compact — the local .pill-btn/.filter-input chrome was
 * deleted in favor of the DS primitives, so a regression back to local
 * classes should fail here.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { BacktestRunControlComponent } from './backtest-run-control.component';

describe('BacktestRunControlComponent', () => {
  async function setup() {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    const fixture = TestBed.createComponent(BacktestRunControlComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('renders filter pills as dse-chip and marks the active option', async () => {
    const { fixture, el } = await setup();
    fixture.componentRef.setInput('statusFilter', 'completed');
    fixture.componentRef.setInput('dateFilter', '7d');
    fixture.detectChanges();

    const chips = el.querySelectorAll<HTMLButtonElement>('.pill-group .dse-chip');
    expect(chips.length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.pill-btn').length).toBe(0);

    const active = Array.from(el.querySelectorAll<HTMLButtonElement>('.dse-chip.active'));
    expect(active.map((c) => c.textContent.trim())).toEqual(
      expect.arrayContaining(['Completed', '7 Days']),
    );
  });

  it('renders filter text inputs as dse-input compact', async () => {
    const { el } = await setup();
    const inputs = el.querySelectorAll<HTMLInputElement>('input.dse-input.compact');
    expect(inputs.length).toBe(2); // symbol + config
    expect(el.querySelectorAll('input:not(.dse-input)').length).toBe(0);
  });

  it('emits statusFilterChange on chip click', async () => {
    const { component, el } = await setup();
    const emitted: unknown[] = [];
    component.statusFilterChange.subscribe((v) => emitted.push(v));

    const chip = Array.from(el.querySelectorAll<HTMLButtonElement>('.pill-group .dse-chip'))
      .find((c) => c.textContent.trim() === 'Failed')!;
    chip.click();
    expect(emitted).toEqual(['failed']);
  });

  it('emits includeArchivedChange on the archive chip click', async () => {
    const { component, el } = await setup();
    const emitted: boolean[] = [];
    component.includeArchivedChange.subscribe((v) => emitted.push(v));

    const chip = Array.from(el.querySelectorAll<HTMLButtonElement>('.dse-chip'))
      .find((c) => c.textContent.trim() === 'Include archived')!;
    chip.click();
    expect(emitted).toEqual([true]);
  });
});
