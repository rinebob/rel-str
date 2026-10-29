import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OptionsReplayRunListComponent } from './options-replay-run-list.component';
import type { OptionsReplayRunUi } from '../../common/options-replay.types';

function makeRun(overrides: Partial<OptionsReplayRunUi> = {}): OptionsReplayRunUi {
  return {
    runId: '2026-10-28_wed_150000_manual_ab1c',
    templateId: 'csp-45-20',
    symbols: ['SPY', 'QQQ'],
    startDate: '2026-01-02',
    status: 'running',
    totalLists: 2,
    completedLists: 1,
    failedLists: 0,
    createdAtIso: '2026-10-28T15:00:00Z',
    ...overrides,
  };
}

describe('OptionsReplayRunListComponent', () => {
  async function setup(runs: OptionsReplayRunUi[] = [makeRun()]) {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionsReplayRunListComponent);
    fixture.componentRef.setInput('runs', runs);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  it('renders run rows with template name, symbols, and progress', async () => {
    const { component, fixture } = await setup();
    const row = component.viewRuns()[0];

    expect(row.templateName).toBe('45DTE 20Δ put (CSP)');
    expect(row.symbolsText).toBe('SPY, QQQ');
    expect(row.progressText).toBe('1 / 2');
    expect(row.progressCompletedPercent).toBe(50);

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('tr.run-row').length).toBe(1);
    expect(el.textContent).toContain('45DTE 20Δ put (CSP)');
  });

  it('falls back to templateId for unknown templates', async () => {
    const { component } = await setup([makeRun({ templateId: 'retired-x' })]);
    expect(component.viewRuns()[0].templateName).toBe('retired-x');
  });

  it('maps status to icon/color visuals', async () => {
    const { component } = await setup([
      makeRun({ runId: 'a', status: 'completed' }),
      makeRun({ runId: 'b', status: 'failed' }),
      makeRun({ runId: 'c', status: 'pending' }),
    ]);
    const rows = component.viewRuns();
    expect(rows[0].statusIconName).toBe('check_circle');
    expect(rows[1].statusIconName).toBe('error');
    expect(rows[2].statusIconName).toBe('schedule');
  });

  it('shows a failed-count badge only when failedLists > 0', async () => {
    const { fixture } = await setup([
      makeRun({ runId: 'a', failedLists: 2 }),
      makeRun({ runId: 'b', failedLists: 0 }),
    ]);
    const badges = fixture.nativeElement.querySelectorAll('.failed-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent.trim()).toBe('2');
  });

  it('progress text is a dash when totalLists is zero', async () => {
    const { component } = await setup([makeRun({ totalLists: 0, completedLists: 0 })]);
    expect(component.viewRuns()[0].progressText).toBe('—');
  });

  it('emits selectRun with the runId on row click', async () => {
    const { component, fixture } = await setup();
    const emitted: string[] = [];
    component.selectRun.subscribe((id) => emitted.push(id));

    (fixture.nativeElement.querySelector('tr.run-row') as HTMLElement).click();
    expect(emitted).toEqual(['2026-10-28_wed_150000_manual_ab1c']);
  });

  it('renders the empty state when there are no runs', async () => {
    const { fixture } = await setup([]);
    expect(fixture.nativeElement.textContent).toContain('No selection replay runs yet');
  });
});
