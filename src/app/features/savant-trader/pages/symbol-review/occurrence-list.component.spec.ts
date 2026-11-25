/**
 * Unit tests for OccurrenceListComponent — the dumb-view rows: checkbox
 * reflect+emit with pending disable, INTERIM/CONFIRMED chip classes,
 * the "new since last visit" divider at the store-provided index, and
 * the per-row error line.
 */

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { OccurrenceListComponent } from './occurrence-list.component';
import { TradeSide } from '@common';
import type { SignalReviewOccurrence } from '@paper-trading/contracts';

const occ = (over: Partial<SignalReviewOccurrence> = {}): SignalReviewOccurrence => ({
  occurrenceId: 'AAPL_2026-11-14_D_ST_TREND_RIDER_V2_LONG',
  symbol: 'AAPL',
  signalType: 'D_ST_TREND_RIDER_V2_LONG',
  signalBarDate: '2026-11-14',
  signalTimeframe: 'D',
  direction: TradeSide.LONG,
  signalStatus: 'CONFIRMED',
  signalIndicators: {},
  sourceRunId: 'run-1',
  checked: false,
  ...over,
});

describe('OccurrenceListComponent', () => {
  let fixture: ComponentFixture<OccurrenceListComponent>;
  let component: OccurrenceListComponent;

  const rows = () => fixture.debugElement.queryAll(By.css('.occ-row'));
  const rowEl = (i: number) => rows()[i].nativeElement as HTMLElement;
  const checkbox = (i: number) =>
    rowEl(i).querySelector<HTMLInputElement>('input[type=checkbox]')!;

  const setup = (
    occurrences: SignalReviewOccurrence[],
    over: { dividerIndex?: number; togglePending?: Record<string, true>; rowErrors?: Record<string, string> } = {},
  ) => {
    fixture = TestBed.createComponent(OccurrenceListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('occurrences', occurrences);
    fixture.componentRef.setInput('dividerIndex', over.dividerIndex ?? occurrences.length);
    fixture.componentRef.setInput('togglePending', over.togglePending ?? {});
    fixture.componentRef.setInput('rowErrors', over.rowErrors ?? {});
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [OccurrenceListComponent] });
  });

  it('renders a row per occurrence with date, type, direction, and status chip', () => {
    setup([
      occ({ occurrenceId: 'o1', signalBarDate: '2026-11-14', signalType: 'D_ST_TREND_RIDER_V2_LONG' }),
      occ({ occurrenceId: 'o2', signalBarDate: '2026-11-13', signalType: 'D_ST_TREND_RIDER_V1_SHORT', direction: TradeSide.SHORT }),
    ]);
    expect(rows()).toHaveLength(2);
    expect(rowEl(0).textContent).toContain('2026-11-14');
    expect(rowEl(0).textContent).toContain('D_ST_TREND_RIDER_V2_LONG');
    expect(rowEl(1).querySelector('.occ-dir')!.textContent).toContain('short');
  });

  it('INTERIM chip is visually distinct from CONFIRMED', () => {
    setup([
      occ({ occurrenceId: 'o1', signalStatus: 'INTERIM' }),
      occ({ occurrenceId: 'o2', signalStatus: 'CONFIRMED' }),
    ]);
    expect(rowEl(0).querySelector('.occ-chip.interim')).toBeTruthy();
    expect(rowEl(0).querySelector('.occ-chip.confirmed')).toBeNull();
    expect(rowEl(1).querySelector('.occ-chip.confirmed')).toBeTruthy();
    expect(rowEl(1).querySelector('.occ-chip.interim')).toBeNull();
  });

  it('checkbox reflects checked and emits the occurrence on change', () => {
    const checked = occ({ occurrenceId: 'o1', checked: true, tradeId: 't-1' });
    const unchecked = occ({ occurrenceId: 'o2' });
    setup([checked, unchecked]);
    const emitted: SignalReviewOccurrence[] = [];
    component.toggle.subscribe((o) => emitted.push(o));

    expect(checkbox(0).checked).toBe(true);
    expect(checkbox(1).checked).toBe(false);
    expect(rowEl(0).classList.contains('checked')).toBe(true);
    expect(rowEl(1).classList.contains('checked')).toBe(false);

    checkbox(1).click();
    expect(emitted).toEqual([unchecked]);
  });

  it('snaps the box back to model state on tap — confirmed, never optimistic', () => {
    const row = occ({ occurrenceId: 'o1', checked: true, tradeId: 't-1' });
    setup([row]);
    // A refused delete leaves occ.checked true — the click's native flip
    // must not stick, or the box would show unchecked against a live trade.
    checkbox(0).click();
    expect(checkbox(0).checked).toBe(true);
  });

  it('disables the checkbox while the row is pending', () => {
    const pending = occ({ occurrenceId: 'o1' });
    setup([pending, occ({ occurrenceId: 'o2' })], {
      togglePending: { o1: true },
    });
    expect(checkbox(0).disabled).toBe(true);
    expect(checkbox(1).disabled).toBe(false);
  });

  it('renders the divider before the first old row when a new section exists', () => {
    setup([
      occ({ occurrenceId: 'o1', signalBarDate: '2026-11-14' }),
      occ({ occurrenceId: 'o2', signalBarDate: '2026-11-12' }),
      occ({ occurrenceId: 'o3', signalBarDate: '2026-11-10' }),
    ], { dividerIndex: 1 });
    const items = fixture.debugElement.queryAll(By.css('.occ-list > li'));
    expect(items[1].nativeElement.classList.contains('visit-divider')).toBe(true);
    expect(items[1].nativeElement.textContent).toContain('new since last visit');
    expect(fixture.debugElement.queryAll(By.css('.visit-divider'))).toHaveLength(1);
  });

  it('renders no divider when all rows are old (index 0) or all new (index = length)', () => {
    setup([occ({ occurrenceId: 'o1' })], { dividerIndex: 0 });
    expect(fixture.debugElement.queryAll(By.css('.visit-divider'))).toHaveLength(0);

    setup([occ({ occurrenceId: 'o1' })], { dividerIndex: 1 });
    expect(fixture.debugElement.queryAll(By.css('.visit-divider'))).toHaveLength(0);
  });

  it('renders the per-row error line from rowErrors', () => {
    const failing = occ({ occurrenceId: 'o1', checked: true, tradeId: 't-1' });
    setup([failing], {
      dividerIndex: 1,
      rowErrors: { o1: 'cohort membership — not signal-scoped' },
    });
    const err = rowEl(0).querySelector('.occ-error');
    expect(err).toBeTruthy();
    expect(err!.textContent).toContain('cohort membership — not signal-scoped');
  });

  it('shows no error line when the row has none', () => {
    setup([occ({ occurrenceId: 'o1' })]);
    expect(rowEl(0).querySelector('.occ-error')).toBeNull();
  });
});
