import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OptionsReplayRunListComponent } from './options-replay-run-list.component';
import type { ReplayListRow, ReplaySelection } from '../../common/options-replay.types';

function makeRow(overrides: Partial<ReplayListRow> = {}): ReplayListRow {
  return {
    runId: '2026-10-28_wed_150000_manual_ab1c_SPY',
    symbol: 'SPY',
    templateId: 'csp-45-20',
    startDate: '2026-01-02',
    createdAtIso: '2026-10-28T15:00:00Z',
    status: 'success',
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

  it('renders one row per run — a run IS one symbol (#1430)', async () => {
    const { component, fixture } = await setup([
      makeRow({ symbol: 'SPY' }),
      makeRow({ runId: 'run-b_QQQ', symbol: 'QQQ', status: 'pending' }),
      makeRow({ runId: 'run-c_IWM', symbol: 'IWM', status: 'failed' }),
    ]);

    expect(component.viewRows().length).toBe(3);

    const el: HTMLElement = fixture.nativeElement;
    const domRows = el.querySelectorAll('tr.run-row');
    expect(domRows.length).toBe(3);
    expect(el.textContent).toContain('SPY');
    expect(el.textContent).toContain('QQQ');
    expect(el.textContent).toContain('IWM');
  });

  it('renders template name and start date from the run', async () => {
    const { component, fixture } = await setup();
    const row = component.viewRows()[0];

    expect(row.templateName).toBe('45DTE 20Δ put (CSP)');
    expect(row.startDateText).toBe('2026-01-02');

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('45DTE 20Δ put (CSP)');
    expect(el.textContent).toContain('2026-01-02');
  });

  it('falls back to templateId for unknown templates', async () => {
    const { component } = await setup([makeRow({ templateId: 'retired-x' })]);
    expect(component.viewRows()[0].templateName).toBe('retired-x');
  });

  it('maps row status to icon/color visuals', async () => {
    const { component } = await setup([
      makeRow({ symbol: 'SPY', status: 'success' }),
      makeRow({ symbol: 'QQQ', status: 'failed' }),
      makeRow({ symbol: 'IWM', status: 'pending' }),
    ]);
    const rows = component.viewRows();
    expect(rows[0].statusIconName).toBe('check_circle');
    expect(rows[1].statusIconName).toBe('error');
    expect(rows[2].statusIconName).toBe('schedule');
  });

  it('shows a failed badge only on failed rows', async () => {
    const { fixture } = await setup([
      makeRow({ symbol: 'SPY', status: 'success' }),
      makeRow({ symbol: 'QQQ', status: 'failed' }),
    ]);
    const badges = fixture.nativeElement.querySelectorAll('.failed-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent.trim()).toBe('failed');
  });

  it('emits the runId on row click', async () => {
    const { component, fixture } = await setup([
      makeRow({ symbol: 'SPY' }),
      makeRow({ runId: '2026-10-28_wed_150000_manual_zx9q_QQQ', symbol: 'QQQ' }),
    ]);
    const emitted: ReplaySelection[] = [];
    component.selectRow.subscribe((sel) => emitted.push(sel));

    const rows = fixture.nativeElement.querySelectorAll('tr.run-row');
    (rows[1] as HTMLElement).click();
    expect(emitted).toEqual(['2026-10-28_wed_150000_manual_zx9q_QQQ']);
  });

  it('marks the selected row by runId — the symbol is implied (#1430)', async () => {
    const { component, fixture } = await setup([
      makeRow({ symbol: 'SPY' }),
      makeRow({ runId: '2026-10-28_wed_150000_manual_zx9q_QQQ', symbol: 'QQQ' }),
    ]);
    fixture.componentRef.setInput('selectedRunId', '2026-10-28_wed_150000_manual_zx9q_QQQ');
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tr.run-row');
    expect(rows[0].classList.contains('selected')).toBe(false);
    expect(rows[1].classList.contains('selected')).toBe(true);
  });

  it('marks no row selected when the selectedRunId matches none', async () => {
    const { fixture } = await setup([makeRow({ symbol: 'SPY' })]);
    fixture.componentRef.setInput('selectedRunId', 'run-other_QQQ');
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('tr.run-row');
    expect(row.classList.contains('selected')).toBe(false);
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
        makeRow({ symbol: 'SPY', status: 'failed' }),
        makeRow({ symbol: 'QQQ', status: 'success' }),
        makeRow({ symbol: 'IWM', status: 'pending' }),
      ]);

      const rows = fixture.nativeElement.querySelectorAll('tr.run-row');
      expect(rows[0].querySelector('.rerun-btn')).toBeTruthy();
      expect(rows[1].querySelector('.rerun-btn')).toBeNull();
      expect(rows[2].querySelector('.rerun-btn')).toBeNull();
    });

    it('emits the runId on rerun click without triggering row selection', async () => {
      const { component, fixture } = await setup([
        makeRow({ runId: 'run-failed', status: 'failed' }),
      ]);
      const reruns: string[] = [];
      const selections: ReplaySelection[] = [];
      component.rerun.subscribe((id) => reruns.push(id));
      component.selectRow.subscribe((sel) => selections.push(sel));

      (fixture.nativeElement.querySelector('.rerun-btn') as HTMLButtonElement).click();

      expect(reruns).toEqual(['run-failed']);
      expect(selections).toEqual([]);
    });

    it('a failed row\'s action is enabled unless its retry is in flight', async () => {
      // Under single-symbol runs the row status IS the run status — the
      // old pending/running/cancelled disable branches were unreachable
      // (a `failed` row can't also be pending) and were removed (#1430 r1).
      const { fixture } = await setup([
        makeRow({ symbol: 'SPY', status: 'failed' }),
      ]);

      const btn = fixture.nativeElement.querySelector('.rerun-btn') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it('disables the failed row while its retry is in flight', async () => {
      const { fixture } = await setup([
        makeRow({ runId: 'run-retrying', symbol: 'SPY', status: 'failed' }),
      ]);
      fixture.componentRef.setInput('retryingRunIds', new Set(['run-retrying']));
      fixture.detectChanges();

      const buttons = fixture.nativeElement.querySelectorAll('.rerun-btn') as NodeListOf<HTMLButtonElement>;
      expect(buttons.length).toBe(1);
      expect(buttons[0].disabled).toBe(true);
    });

    it('disables the action while a retry is already in flight for the run', async () => {
      const { fixture } = await setup([
        makeRow({ runId: 'run-retrying', status: 'failed' }),
      ]);
      fixture.componentRef.setInput('retryingRunIds', new Set(['run-retrying']));
      fixture.detectChanges();

      const btn = fixture.nativeElement.querySelector('.rerun-btn') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });
});
