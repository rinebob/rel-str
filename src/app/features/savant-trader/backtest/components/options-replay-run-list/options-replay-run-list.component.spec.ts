import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OptionsReplayRunListComponent } from './options-replay-run-list.component';
import type { ReplayListRow, ReplaySelection } from '../../common/options-replay.types';

function makeRow(overrides: Partial<ReplayListRow> = {}): ReplayListRow {
  return {
    runId: '2026-10-28_wed_150000_manual_ab1c',
    symbol: 'SPY',
    templateId: 'csp-45-20',
    startDate: '2026-01-02',
    createdAtIso: '2026-10-28T15:00:00Z',
    runStatus: 'running',
    symbolStatus: 'success',
    completedLists: 1,
    failedLists: 0,
    totalLists: 2,
    ...overrides,
  };
}

describe('OptionsReplayRunListComponent', () => {
  async function setup(rows: ReplayListRow[] = [makeRow()]) {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionsReplayRunListComponent);
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  it('renders one row per derived (runId, symbol) row', async () => {
    const { component, fixture } = await setup([
      makeRow({ symbol: 'SPY' }),
      makeRow({ symbol: 'QQQ', symbolStatus: 'pending' }),
      makeRow({ runId: 'run-b', symbol: 'IWM', symbolStatus: 'failed' }),
    ]);

    expect(component.viewRows().length).toBe(3);

    const el: HTMLElement = fixture.nativeElement;
    const domRows = el.querySelectorAll('tr.run-row');
    expect(domRows.length).toBe(3);
    expect(el.textContent).toContain('SPY');
    expect(el.textContent).toContain('QQQ');
    expect(el.textContent).toContain('IWM');
  });

  it('renders template name, start date, and progress context from the run', async () => {
    const { component, fixture } = await setup();
    const row = component.viewRows()[0];

    expect(row.templateName).toBe('45DTE 20Δ put (CSP)');
    expect(row.startDateText).toBe('2026-01-02');
    expect(row.progressText).toBe('1 / 2');
    expect(row.progressCompletedPercent).toBe(50);

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('45DTE 20Δ put (CSP)');
    expect(el.textContent).toContain('2026-01-02');
  });

  it('falls back to templateId for unknown templates', async () => {
    const { component } = await setup([makeRow({ templateId: 'retired-x' })]);
    expect(component.viewRows()[0].templateName).toBe('retired-x');
  });

  it('maps symbolStatus to icon/color visuals', async () => {
    const { component } = await setup([
      makeRow({ symbol: 'SPY', symbolStatus: 'success' }),
      makeRow({ symbol: 'QQQ', symbolStatus: 'failed' }),
      makeRow({ symbol: 'IWM', symbolStatus: 'pending' }),
    ]);
    const rows = component.viewRows();
    expect(rows[0].symbolStatusIconName).toBe('check_circle');
    expect(rows[1].symbolStatusIconName).toBe('error');
    expect(rows[2].symbolStatusIconName).toBe('schedule');
  });

  it('shows a failed badge only on failed rows', async () => {
    const { fixture } = await setup([
      makeRow({ symbol: 'SPY', symbolStatus: 'success' }),
      makeRow({ symbol: 'QQQ', symbolStatus: 'failed' }),
    ]);
    const badges = fixture.nativeElement.querySelectorAll('.failed-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent.trim()).toBe('failed');
  });

  it('emits the (runId, symbol) pair on row click', async () => {
    const { component, fixture } = await setup([
      makeRow({ symbol: 'SPY' }),
      makeRow({ symbol: 'QQQ' }),
    ]);
    const emitted: ReplaySelection[] = [];
    component.selectRow.subscribe((sel) => emitted.push(sel));

    const rows = fixture.nativeElement.querySelectorAll('tr.run-row');
    (rows[1] as HTMLElement).click();
    expect(emitted).toEqual([{ runId: '2026-10-28_wed_150000_manual_ab1c', symbol: 'QQQ' }]);
  });

  it('marks the selected row by the composite runId + symbol key', async () => {
    const { component, fixture } = await setup([
      makeRow({ symbol: 'SPY' }),
      makeRow({ symbol: 'QQQ' }),
    ]);
    fixture.componentRef.setInput('selectedRunId', '2026-10-28_wed_150000_manual_ab1c');
    fixture.componentRef.setInput('selectedSymbol', 'QQQ');
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tr.run-row');
    expect(rows[0].classList.contains('selected')).toBe(false);
    expect(rows[1].classList.contains('selected')).toBe(true);
  });

  it('does not mark a row selected when only the runId matches', async () => {
    const { fixture } = await setup([makeRow({ symbol: 'SPY' })]);
    fixture.componentRef.setInput('selectedRunId', '2026-10-28_wed_150000_manual_ab1c');
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('tr.run-row');
    expect(row.classList.contains('selected')).toBe(false);
  });

  it('progress text is a dash when totalLists is zero', async () => {
    const { component } = await setup([makeRow({ totalLists: 0, completedLists: 0 })]);
    expect(component.viewRows()[0].progressText).toBe('—');
  });

  it('renders the empty state when there are no rows', async () => {
    const { fixture } = await setup([]);
    expect(fixture.nativeElement.textContent).toContain('No selection replay runs yet');
  });

  it('reads as a filter miss when rows are empty under active filters', async () => {
    const { fixture } = await setup([]);
    fixture.componentRef.setInput('hasActiveFilters', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No rows match the current filters');
    expect(fixture.nativeElement.textContent).not.toContain('No selection replay runs yet');
  });

  describe('rerun action', () => {
    it('renders the rerun button only on failed symbol rows', async () => {
      const { fixture } = await setup([
        makeRow({ symbol: 'SPY', symbolStatus: 'failed' }),
        makeRow({ symbol: 'QQQ', symbolStatus: 'success' }),
        makeRow({ symbol: 'IWM', symbolStatus: 'pending' }),
      ]);

      const rows = fixture.nativeElement.querySelectorAll('tr.run-row');
      expect(rows[0].querySelector('.rerun-btn')).toBeTruthy();
      expect(rows[1].querySelector('.rerun-btn')).toBeNull();
      expect(rows[2].querySelector('.rerun-btn')).toBeNull();
    });

    it('emits the runId on rerun click without triggering row selection', async () => {
      const { component, fixture } = await setup([
        makeRow({ runId: 'run-failed', symbolStatus: 'failed', runStatus: 'failed' }),
      ]);
      const reruns: string[] = [];
      const selections: ReplaySelection[] = [];
      component.rerun.subscribe((id) => reruns.push(id));
      component.selectRow.subscribe((sel) => selections.push(sel));

      (fixture.nativeElement.querySelector('.rerun-btn') as HTMLButtonElement).click();

      expect(reruns).toEqual(['run-failed']);
      expect(selections).toEqual([]);
    });

    it('disables the action while the run is pending, running, or cancelled', async () => {
      const { fixture } = await setup([
        makeRow({ symbol: 'SPY', symbolStatus: 'failed', runStatus: 'running' }),
        makeRow({ symbol: 'QQQ', symbolStatus: 'failed', runStatus: 'pending' }),
        makeRow({ symbol: 'AMAT', symbolStatus: 'failed', runStatus: 'cancelled' }),
        makeRow({ symbol: 'IWM', symbolStatus: 'failed', runStatus: 'failed' }),
        // Partial failure converges to 'completed' — the dominant
        // real-world retry case must stay enabled.
        makeRow({ symbol: 'NVDA', symbolStatus: 'failed', runStatus: 'completed' }),
      ]);

      const rows = fixture.nativeElement.querySelectorAll('tr.run-row');
      expect((rows[0].querySelector('.rerun-btn') as HTMLButtonElement).disabled).toBe(true);
      expect((rows[1].querySelector('.rerun-btn') as HTMLButtonElement).disabled).toBe(true);
      // The BE refuses to resurrect a cancelled run — no dead button.
      expect((rows[2].querySelector('.rerun-btn') as HTMLButtonElement).disabled).toBe(true);
      expect((rows[3].querySelector('.rerun-btn') as HTMLButtonElement).disabled).toBe(false);
      expect((rows[4].querySelector('.rerun-btn') as HTMLButtonElement).disabled).toBe(false);
    });

    it('disables every failed row of a run while its retry is in flight', async () => {
      const { fixture } = await setup([
        makeRow({ runId: 'run-retrying', symbol: 'SPY', symbolStatus: 'failed', runStatus: 'completed' }),
        makeRow({ runId: 'run-retrying', symbol: 'QQQ', symbolStatus: 'failed', runStatus: 'completed' }),
      ]);
      fixture.componentRef.setInput('retryingRunIds', new Set(['run-retrying']));
      fixture.detectChanges();

      // Retry is run-scoped — one click retries all failed symbols, so
      // every row of the run disables together.
      const buttons = fixture.nativeElement.querySelectorAll('.rerun-btn') as NodeListOf<HTMLButtonElement>;
      expect(buttons.length).toBe(2);
      expect(buttons[0].disabled).toBe(true);
      expect(buttons[1].disabled).toBe(true);
    });

    it('disables the action while a retry is already in flight for the run', async () => {
      const { fixture } = await setup([
        makeRow({ runId: 'run-retrying', symbolStatus: 'failed', runStatus: 'failed' }),
      ]);
      fixture.componentRef.setInput('retryingRunIds', new Set(['run-retrying']));
      fixture.detectChanges();

      const btn = fixture.nativeElement.querySelector('.rerun-btn') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });
});
