/**
 * OptionsReplayRunControlsComponent specs (#1374).
 *
 * Filter/sort toolbar for the Selection Replay run list. Every control
 * emits its change output; template options come from the seeded
 * REPLAY_TEMPLATES registry (shared import — no fetch); the strip carries
 * no config/archive/date controls (legacy-only surfaces).
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OptionsReplayRunControlsComponent } from './options-replay-run-controls.component';
import { REPLAY_TEMPLATES } from '@options-replay/templates';

describe('OptionsReplayRunControlsComponent', () => {
  async function setup() {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionsReplayRunControlsComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    return { fixture, component: fixture.componentInstance, el };
  }

  it('emits newReplay on the primary action and disables it while loading', async () => {
    const { fixture, component, el } = await setup();
    const spy = jest.fn();
    component.newReplay.subscribe(spy);

    const btn = el.querySelector<HTMLButtonElement>('.run-now-btn')!;
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('isLoading', true);
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('.run-now-btn')!.disabled).toBe(true);
  });

  it('emits statusFilterChange on status pill click', async () => {
    const { component, el } = await setup();
    const spy = jest.fn();
    component.statusFilterChange.subscribe(spy);

    const pills = el.querySelectorAll<HTMLButtonElement>('.status-pills .pill-btn');
    // All / Pending / Running / Success / Failed / Cancelled — click 'Failed'
    pills[4].click();
    expect(spy).toHaveBeenCalledWith('failed');
  });

  it('marks the active status pill from the statusFilter input', async () => {
    const { fixture, el } = await setup();
    fixture.componentRef.setInput('statusFilter', 'success');
    fixture.detectChanges();

    const active = el.querySelector('.status-pills .pill-btn.active')!;
    expect(active.textContent!.trim()).toBe('Success');
  });

  it('templateOptions lists the seeded REPLAY_TEMPLATES registry', async () => {
    const { component } = await setup();
    expect(component.templateOptions).toBe(REPLAY_TEMPLATES);
    expect(component.templateOptions.length).toBeGreaterThan(0);
  });

  it('emits templateFilterChange on template select change', async () => {
    const { fixture, component, el } = await setup();
    const spy = jest.fn();
    component.templateFilterChange.subscribe(spy);

    const select = el.querySelector<HTMLSelectElement>('.template-select')!;
    const firstTemplate = REPLAY_TEMPLATES[0];
    select.value = firstTemplate.id;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(spy).toHaveBeenCalledWith(firstTemplate.id);
  });

  it('renders an All option plus one option per registry template', async () => {
    const { el } = await setup();
    const options = el.querySelectorAll<HTMLOptionElement>('.template-select option');
    expect(options.length).toBe(REPLAY_TEMPLATES.length + 1);
    expect(options[0].value).toBe('all');
    expect(options[1].textContent!.trim()).toBe(REPLAY_TEMPLATES[0].name);
  });

  it('emits symbolSearchChange on symbol input', async () => {
    const { component, el } = await setup();
    const spy = jest.fn();
    component.symbolSearchChange.subscribe(spy);

    const input = el.querySelector<HTMLInputElement>('.symbol-input')!;
    input.value = 'spy';
    input.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith('spy');
  });

  it('emits sortByChange on sort select change', async () => {
    const { component, el } = await setup();
    const spy = jest.fn();
    component.sortByChange.subscribe(spy);

    const select = el.querySelector<HTMLSelectElement>('.sort-select')!;
    select.value = 'symbol';
    select.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith('symbol');
  });

  it('emits sortDirectionChange with the flipped direction on toggle', async () => {
    const { fixture, component, el } = await setup();
    const spy = jest.fn();
    component.sortDirectionChange.subscribe(spy);

    fixture.componentRef.setInput('sortDirection', 'desc');
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.sort-direction-btn')!.click();
    expect(spy).toHaveBeenCalledWith('asc');
  });

  it('reflects the sortDirection input on the toggle icon', async () => {
    const { fixture, el } = await setup();
    fixture.componentRef.setInput('sortDirection', 'asc');
    fixture.detectChanges();
    expect(el.querySelector('.sort-direction-btn .dse-icon')!.textContent!.trim()).toBe('arrow_upward');
  });

  it('selects round-trip the sortBy input onto the native select', async () => {
    const { fixture, el } = await setup();
    fixture.componentRef.setInput('sortBy', 'symbol');
    fixture.detectChanges();
    expect(el.querySelector<HTMLSelectElement>('.sort-select')!.value).toBe('symbol');
  });

  it('shows the Clear filters pill only while filters are active, and emits resetFilters on click', async () => {
    const { fixture, component, el } = await setup();
    expect(el.querySelector('.clear-filters-btn')).toBeNull();

    fixture.componentRef.setInput('hasActiveFilters', true);
    fixture.detectChanges();
    const btn = el.querySelector<HTMLButtonElement>('.clear-filters-btn')!;
    expect(btn).not.toBeNull();

    const spy = jest.fn();
    component.resetFilters.subscribe(spy);
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('renders no config, archive, or date controls (replay-scoped strip)', async () => {
    const { el } = await setup();
    expect(el.textContent).not.toContain('Config');
    expect(el.textContent).not.toContain('archived');
    // The control set is exactly the four replay controls — pins the
    // strip against legacy surfaces (Date pills, Config input, archive
    // toggle) regardless of what class names they use.
    const labels = Array.from(el.querySelectorAll<HTMLElement>('.filter-label')).map(
      (n) => n.textContent!.trim(),
    );
    expect(labels).toEqual(['Status', 'Template', 'Symbol', 'Sort']);
  });
});
