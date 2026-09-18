import { Component, Input, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SwingTableComponent } from './swing-table.component';
import type { Swing } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';

function makeSwing(overrides: Partial<Swing> = {}): Swing {
  return {
    direction: 'up',
    start: { time: 1700000000000, price: 100, barIndex: 0 },
    end: { time: 17000086400000, price: 110, barIndex: 10 },
    magnitudePercent: 10,
    magnitudeAbsolute: 10,
    duration: 10,
    volume: 50000,
    confirmed: true,
    ...overrides,
  };
}

/** Host component that binds inputs via template — needed because jest-preset-angular
 *  doesn't support ComponentRef.setInput() with signal-based input(). */
@Component({
  standalone: true,
  imports: [SwingTableComponent],
  template: `<app-swing-table [swings]="swings" [smallSwings]="smallSwings" [loading]="loading" [error]="error" />`,
})
class HostComponent {
  @Input() swings: Swing[] = [];
  @Input() smallSwings: Swing[] | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;
}

describe('SwingTableComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  it('creates', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement).toBeTruthy();
  });

  it('renders all swing columns in the header', () => {
    host.swings = [makeSwing()];
    host.loading = false;
    host.error = null;
    fixture.detectChanges();

    const headers = fixture.nativeElement.querySelectorAll('thead th');
    const headerText = Array.from(headers).map((h) => (h as HTMLElement).textContent!.trim());
    const expectedColumns = ['#', 'Direction', 'Start Date', 'End Date', 'Duration', 'Magnitude %', 'Magnitude $', 'Start Price', 'End Price', 'Volume'];
    for (const col of expectedColumns) {
      expect(headerText.some((h) => h.includes(col))).toBe(true);
    }
  });

  it('renders a row for each swing', () => {
    host.swings = [
      makeSwing({ direction: 'up', magnitudePercent: 10 }),
      makeSwing({ direction: 'down', magnitudePercent: -5, start: { time: 17000086400000, price: 110, barIndex: 10 }, end: { time: 17000172800000, price: 104.5, barIndex: 20 } }),
    ];
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  /** Helper: extract the text content of the nth column from each row. */
  function columnValues(colIndex: number): string[] {
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    return Array.from(rows).map((r) => {
      const cells = (r as HTMLElement).querySelectorAll('td');
      return (cells[colIndex] as HTMLElement).textContent!.trim();
    });
  }

  /** Helper: click the header at the given column index to sort. */
  function clickHeader(colIndex: number): void {
    const headers = fixture.nativeElement.querySelectorAll('thead th');
    (headers[colIndex] as HTMLElement).click();
    fixture.detectChanges();
  }

  it('sorts by direction ascending then descending on header click', () => {
    host.swings = [
      makeSwing({ direction: 'up', start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 110, barIndex: 1 } }),
      makeSwing({ direction: 'down', start: { time: 1000, price: 110, barIndex: 1 }, end: { time: 2000, price: 100, barIndex: 2 } }),
      makeSwing({ direction: 'up', start: { time: 2000, price: 100, barIndex: 2 }, end: { time: 3000, price: 120, barIndex: 3 } }),
    ];
    fixture.detectChanges();

    // Direction column is index 1
    clickHeader(1);
    expect(columnValues(1)).toEqual(['▼ down', '▲ up', '▲ up']);

    clickHeader(1);
    expect(columnValues(1)).toEqual(['▲ up', '▲ up', '▼ down']);
  });

  it('sorts by duration ascending then descending on header click', () => {
    host.swings = [
      makeSwing({ duration: 20, start: { time: 0, price: 100, barIndex: 0 }, end: { time: 20000, price: 110, barIndex: 20 } }),
      makeSwing({ duration: 5, start: { time: 20000, price: 110, barIndex: 20 }, end: { time: 25000, price: 100, barIndex: 25 } }),
      makeSwing({ duration: 10, start: { time: 25000, price: 100, barIndex: 25 }, end: { time: 35000, price: 120, barIndex: 35 } }),
    ];
    fixture.detectChanges();

    // Duration column is index 4
    clickHeader(4);
    expect(columnValues(4)).toEqual(['5', '10', '20']);

    clickHeader(4);
    expect(columnValues(4)).toEqual(['20', '10', '5']);
  });

  it('sorts by magnitude percent ascending then descending on header click', () => {
    host.swings = [
      makeSwing({ magnitudePercent: 20, start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 120, barIndex: 1 } }),
      makeSwing({ magnitudePercent: -5, start: { time: 1000, price: 120, barIndex: 1 }, end: { time: 2000, price: 114, barIndex: 2 } }),
      makeSwing({ magnitudePercent: 10, start: { time: 2000, price: 114, barIndex: 2 }, end: { time: 3000, price: 125.4, barIndex: 3 } }),
    ];
    fixture.detectChanges();

    // Magnitude % column is index 5
    clickHeader(5);
    expect(columnValues(5)).toEqual(['-5.00%', '+10.00%', '+20.00%']);

    clickHeader(5);
    expect(columnValues(5)).toEqual(['+20.00%', '+10.00%', '-5.00%']);
  });

  it('sorts by volume ascending then descending on header click', () => {
    host.swings = [
      makeSwing({ volume: 30000, start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 110, barIndex: 1 } }),
      makeSwing({ volume: 10000, start: { time: 1000, price: 110, barIndex: 1 }, end: { time: 2000, price: 100, barIndex: 2 } }),
      makeSwing({ volume: 20000, start: { time: 2000, price: 100, barIndex: 2 }, end: { time: 3000, price: 120, barIndex: 3 } }),
    ];
    fixture.detectChanges();

    // Volume column is index 9
    clickHeader(9);
    expect(columnValues(9)).toEqual(['10,000', '20,000', '30,000']);

    clickHeader(9);
    expect(columnValues(9)).toEqual(['30,000', '20,000', '10,000']);
  });

  // -------------------------------------------------------------------------
  // Filtering — direction dropdown
  // -------------------------------------------------------------------------

  it('filters by direction using the dropdown', () => {
    host.swings = [
      makeSwing({ direction: 'up', start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 110, barIndex: 1 } }),
      makeSwing({ direction: 'down', start: { time: 1000, price: 110, barIndex: 1 }, end: { time: 2000, price: 100, barIndex: 2 } }),
      makeSwing({ direction: 'up', start: { time: 2000, price: 100, barIndex: 2 }, end: { time: 3000, price: 120, barIndex: 3 } }),
    ];
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;

    // Filter to "up" only
    select.value = 'up';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    const dirs = columnValues(1);
    expect(dirs.every((d) => d.includes('up'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Filtering — date range
  // -------------------------------------------------------------------------

  it('filters by date range using the from/to inputs', () => {
    host.swings = [
      makeSwing({ start: { time: new Date('2023-01-01').getTime(), price: 100, barIndex: 0 }, end: { time: new Date('2023-01-10').getTime(), price: 110, barIndex: 5 } }),
      makeSwing({ start: { time: new Date('2023-02-01').getTime(), price: 110, barIndex: 5 }, end: { time: new Date('2023-02-10').getTime(), price: 100, barIndex: 10 } }),
      makeSwing({ start: { time: new Date('2023-03-01').getTime(), price: 100, barIndex: 10 }, end: { time: new Date('2023-03-10').getTime(), price: 120, barIndex: 15 } }),
    ];
    fixture.detectChanges();

    const dateInputs = fixture.nativeElement.querySelectorAll('input[type="date"]') as NodeListOf<HTMLInputElement>;
    // Date From = index 0, Date To = index 1
    dateInputs[0].value = '2023-02-01';
    dateInputs[0].dispatchEvent(new Event('change'));
    dateInputs[1].value = '2023-02-15';
    dateInputs[1].dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
  });

  it('Date To filter includes swings ending later on the selected day', () => {
    // A swing ending at 12:00 UTC on 2023-02-10 should be included when
    // "Date To" is set to 2023-02-10 (end-of-day inclusive).
    const endOfDay = new Date('2023-02-10').getTime() + 12 * 60 * 60 * 1000; // noon UTC
    host.swings = [
      makeSwing({ start: { time: new Date('2023-02-01').getTime(), price: 110, barIndex: 5 }, end: { time: endOfDay, price: 100, barIndex: 10 } }),
    ];
    fixture.detectChanges();

    const dateInputs = fixture.nativeElement.querySelectorAll('input[type="date"]') as NodeListOf<HTMLInputElement>;
    dateInputs[1].value = '2023-02-10';
    dateInputs[1].dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Filtering — duration range
  // -------------------------------------------------------------------------

  it('filters by duration range using min/max inputs', () => {
    host.swings = [
      makeSwing({ duration: 5, start: { time: 0, price: 100, barIndex: 0 }, end: { time: 5000, price: 110, barIndex: 5 } }),
      makeSwing({ duration: 15, start: { time: 5000, price: 110, barIndex: 5 }, end: { time: 20000, price: 100, barIndex: 20 } }),
      makeSwing({ duration: 30, start: { time: 20000, price: 100, barIndex: 20 }, end: { time: 50000, price: 120, barIndex: 50 } }),
    ];
    fixture.detectChanges();

    const numberInputs = fixture.nativeElement.querySelectorAll('input[type="number"]') as NodeListOf<HTMLInputElement>;
    // Duration Min = index 0, Duration Max = index 1
    numberInputs[0].value = '10';
    numberInputs[0].dispatchEvent(new Event('input'));
    numberInputs[1].value = '20';
    numberInputs[1].dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(columnValues(4)).toEqual(['15']);
  });

  // -------------------------------------------------------------------------
  // Filtering — magnitude range
  // -------------------------------------------------------------------------

  it('filters by magnitude range using min/max inputs', () => {
    host.swings = [
      makeSwing({ magnitudeAbsolute: 5, start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 105, barIndex: 1 } }),
      makeSwing({ magnitudeAbsolute: 15, start: { time: 1000, price: 110, barIndex: 1 }, end: { time: 2000, price: 95, barIndex: 2 } }),
      makeSwing({ magnitudeAbsolute: 30, start: { time: 2000, price: 100, barIndex: 2 }, end: { time: 3000, price: 130, barIndex: 3 } }),
    ];
    fixture.detectChanges();

    const numberInputs = fixture.nativeElement.querySelectorAll('input[type="number"]') as NodeListOf<HTMLInputElement>;
    // Magnitude Min = index 2, Magnitude Max = index 3
    numberInputs[2].value = '10';
    numberInputs[2].dispatchEvent(new Event('input'));
    numberInputs[3].value = '20';
    numberInputs[3].dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(columnValues(6)).toEqual(['15.00']);
  });

  // -------------------------------------------------------------------------
  // Projected swing styling
  // -------------------------------------------------------------------------

  it('applies distinct styling to the projected (unconfirmed) last row', () => {
    host.swings = [
      makeSwing({ confirmed: true, start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 110, barIndex: 1 } }),
      makeSwing({ confirmed: true, direction: 'down', start: { time: 1000, price: 110, barIndex: 1 }, end: { time: 2000, price: 100, barIndex: 2 } }),
      makeSwing({ confirmed: false, direction: 'up', start: { time: 2000, price: 100, barIndex: 2 }, end: { time: 3000, price: 120, barIndex: 3 } }),
    ];
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);
    const lastRow = rows[rows.length - 1];
    expect(lastRow.classList.contains('projected')).toBe(true);
    expect(rows[0].classList.contains('projected')).toBe(false);
    expect(rows[1].classList.contains('projected')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  it('renders an empty state when no swings exist', () => {
    host.swings = [];
    fixture.detectChanges();

    const emptyState = fixture.nativeElement.querySelector('.swing-table-empty');
    expect(emptyState).toBeTruthy();
    expect(emptyState.textContent).toContain('No swings');

    const table = fixture.nativeElement.querySelector('table.swing-table');
    expect(table).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Sorting — remaining columns
  // -------------------------------------------------------------------------

  it('sorts by index ascending then descending on header click', () => {
    host.swings = [
      makeSwing({ start: { time: 2000, price: 100, barIndex: 2 }, end: { time: 3000, price: 110, barIndex: 3 } }),
      makeSwing({ start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 110, barIndex: 1 } }),
      makeSwing({ start: { time: 1000, price: 110, barIndex: 1 }, end: { time: 2000, price: 100, barIndex: 2 } }),
    ];
    fixture.detectChanges();

    // Index column is 0. Default sort is index asc, so first click toggles to desc.
    clickHeader(0);
    expect(columnValues(0)).toEqual(['3', '2', '1']);

    clickHeader(0);
    expect(columnValues(0)).toEqual(['1', '2', '3']);
  });

  it('sorts by start date ascending then descending on header click', () => {
    // Use UTC noon timestamps to avoid timezone shifting the formatted date.
    const jan = Date.UTC(2023, 0, 1, 12);
    const feb = Date.UTC(2023, 1, 1, 12);
    const mar = Date.UTC(2023, 2, 1, 12);
    host.swings = [
      makeSwing({ start: { time: mar, price: 100, barIndex: 0 }, end: { time: mar + 86_400_000, price: 110, barIndex: 5 } }),
      makeSwing({ start: { time: jan, price: 100, barIndex: 0 }, end: { time: jan + 86_400_000, price: 110, barIndex: 5 } }),
      makeSwing({ start: { time: feb, price: 100, barIndex: 0 }, end: { time: feb + 86_400_000, price: 110, barIndex: 5 } }),
    ];
    fixture.detectChanges();

    // Start Date column is 2
    clickHeader(2);
    const asc = columnValues(2);
    expect(asc[0]).toContain('Jan');
    expect(asc[1]).toContain('Feb');
    expect(asc[2]).toContain('Mar');

    clickHeader(2);
    const desc = columnValues(2);
    expect(desc[0]).toContain('Mar');
    expect(desc[1]).toContain('Feb');
    expect(desc[2]).toContain('Jan');
  });

  it('sorts by end date ascending then descending on header click', () => {
    host.swings = [
      makeSwing({ start: { time: 0, price: 100, barIndex: 0 }, end: { time: new Date('2023-03-10').getTime(), price: 110, barIndex: 5 } }),
      makeSwing({ start: { time: 0, price: 100, barIndex: 0 }, end: { time: new Date('2023-01-10').getTime(), price: 110, barIndex: 5 } }),
      makeSwing({ start: { time: 0, price: 100, barIndex: 0 }, end: { time: new Date('2023-02-10').getTime(), price: 110, barIndex: 5 } }),
    ];
    fixture.detectChanges();

    // End Date column is 3
    clickHeader(3);
    const asc = columnValues(3);
    expect(asc[0]).toContain('Jan');
    expect(asc[1]).toContain('Feb');
    expect(asc[2]).toContain('Mar');

    clickHeader(3);
    const desc = columnValues(3);
    expect(desc[0]).toContain('Mar');
    expect(desc[1]).toContain('Feb');
    expect(desc[2]).toContain('Jan');
  });

  it('sorts by magnitude absolute ascending then descending on header click', () => {
    host.swings = [
      makeSwing({ magnitudeAbsolute: 20, start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 120, barIndex: 1 } }),
      makeSwing({ magnitudeAbsolute: 5, start: { time: 1000, price: 120, barIndex: 1 }, end: { time: 2000, price: 115, barIndex: 2 } }),
      makeSwing({ magnitudeAbsolute: 15, start: { time: 2000, price: 115, barIndex: 2 }, end: { time: 3000, price: 130, barIndex: 3 } }),
    ];
    fixture.detectChanges();

    // Magnitude $ column is 6
    clickHeader(6);
    expect(columnValues(6)).toEqual(['5.00', '15.00', '20.00']);

    clickHeader(6);
    expect(columnValues(6)).toEqual(['20.00', '15.00', '5.00']);
  });

  it('sorts by start price ascending then descending on header click', () => {
    host.swings = [
      makeSwing({ start: { time: 0, price: 150, barIndex: 0 }, end: { time: 1000, price: 160, barIndex: 1 } }),
      makeSwing({ start: { time: 1000, price: 100, barIndex: 1 }, end: { time: 2000, price: 110, barIndex: 2 } }),
      makeSwing({ start: { time: 2000, price: 120, barIndex: 2 }, end: { time: 3000, price: 130, barIndex: 3 } }),
    ];
    fixture.detectChanges();

    // Start Price column is 7
    clickHeader(7);
    expect(columnValues(7)).toEqual(['100.00', '120.00', '150.00']);

    clickHeader(7);
    expect(columnValues(7)).toEqual(['150.00', '120.00', '100.00']);
  });

  it('sorts by end price ascending then descending on header click', () => {
    host.swings = [
      makeSwing({ start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 160, barIndex: 1 } }),
      makeSwing({ start: { time: 1000, price: 110, barIndex: 1 }, end: { time: 2000, price: 100, barIndex: 2 } }),
      makeSwing({ start: { time: 2000, price: 120, barIndex: 2 }, end: { time: 3000, price: 130, barIndex: 3 } }),
    ];
    fixture.detectChanges();

    // End Price column is 8
    clickHeader(8);
    expect(columnValues(8)).toEqual(['100.00', '130.00', '160.00']);

    clickHeader(8);
    expect(columnValues(8)).toEqual(['160.00', '130.00', '100.00']);
  });

  // -------------------------------------------------------------------------
  // Loading and error states
  // -------------------------------------------------------------------------

  it('renders a loading indicator when loading', () => {
    host.swings = [];
    host.loading = true;
    fixture.detectChanges();

    const loadingEl = fixture.nativeElement.querySelector('.swing-table-loading');
    expect(loadingEl).toBeTruthy();
    expect(loadingEl.textContent).toContain('Loading');

    const table = fixture.nativeElement.querySelector('table.swing-table');
    expect(table).toBeNull();
  });

  it('renders an error message when error is set', () => {
    host.swings = [];
    host.error = 'Failed to load swings';
    fixture.detectChanges();

    const errorEl = fixture.nativeElement.querySelector('.swing-table-error');
    expect(errorEl).toBeTruthy();
    expect(errorEl.textContent).toContain('Failed to load swings');

    const table = fixture.nativeElement.querySelector('table.swing-table');
    expect(table).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Edge cases — invalid filter inputs
  // -------------------------------------------------------------------------

  it('ignores NaN numeric filter values (duration min)', () => {
    host.swings = [
      makeSwing({ duration: 5, start: { time: 0, price: 100, barIndex: 0 }, end: { time: 5000, price: 110, barIndex: 5 } }),
      makeSwing({ duration: 15, start: { time: 5000, price: 110, barIndex: 5 }, end: { time: 20000, price: 100, barIndex: 20 } }),
    ];
    fixture.detectChanges();

    const numberInputs = fixture.nativeElement.querySelectorAll('input[type="number"]') as NodeListOf<HTMLInputElement>;
    // Setting a non-numeric value that Number() converts to NaN
    numberInputs[0].value = 'abc';
    numberInputs[0].dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // NaN guard should ignore the value — all rows remain
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('ignores NaN numeric filter values (magnitude max)', () => {
    host.swings = [
      makeSwing({ magnitudeAbsolute: 5, start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 105, barIndex: 1 } }),
      makeSwing({ magnitudeAbsolute: 15, start: { time: 1000, price: 110, barIndex: 1 }, end: { time: 2000, price: 95, barIndex: 2 } }),
    ];
    fixture.detectChanges();

    const numberInputs = fixture.nativeElement.querySelectorAll('input[type="number"]') as NodeListOf<HTMLInputElement>;
    // Magnitude Max = index 3
    numberInputs[3].value = 'xyz';
    numberInputs[3].dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('ignores invalid date filter values', () => {
    host.swings = [
      makeSwing({ start: { time: new Date('2023-01-01').getTime(), price: 100, barIndex: 0 }, end: { time: new Date('2023-01-10').getTime(), price: 110, barIndex: 5 } }),
      makeSwing({ start: { time: new Date('2023-02-01').getTime(), price: 110, barIndex: 5 }, end: { time: new Date('2023-02-10').getTime(), price: 100, barIndex: 10 } }),
    ];
    fixture.detectChanges();

    const dateInputs = fixture.nativeElement.querySelectorAll('input[type="date"]') as NodeListOf<HTMLInputElement>;
    // Set an invalid date — the browser may reject it, leaving value empty.
    // If the value is empty, the filter is skipped. If somehow non-empty but
    // invalid, new Date().getTime() returns NaN and the guard skips it.
    dateInputs[0].value = '';
    dateInputs[0].dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('handles min > max filter range (duration)', () => {
    host.swings = [
      makeSwing({ duration: 5, start: { time: 0, price: 100, barIndex: 0 }, end: { time: 5000, price: 110, barIndex: 5 } }),
      makeSwing({ duration: 15, start: { time: 5000, price: 110, barIndex: 5 }, end: { time: 20000, price: 100, barIndex: 20 } }),
    ];
    fixture.detectChanges();

    const numberInputs = fixture.nativeElement.querySelectorAll('input[type="number"]') as NodeListOf<HTMLInputElement>;
    // Duration Min = index 0, Duration Max = index 1
    // min=20 > max=10 — no rows match both conditions
    numberInputs[0].value = '20';
    numberInputs[0].dispatchEvent(new Event('input'));
    numberInputs[1].value = '10';
    numberInputs[1].dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Edge cases — filtered-to-empty state
  // -------------------------------------------------------------------------

  it('shows "no matches" message when filters remove all rows', () => {
    host.swings = [
      makeSwing({ direction: 'up', duration: 5, start: { time: 0, price: 100, barIndex: 0 }, end: { time: 5000, price: 110, barIndex: 5 } }),
      makeSwing({ direction: 'down', duration: 15, start: { time: 5000, price: 110, barIndex: 5 }, end: { time: 20000, price: 100, barIndex: 20 } }),
    ];
    fixture.detectChanges();

    // Filter duration min=100 — no rows match
    const numberInputs = fixture.nativeElement.querySelectorAll('input[type="number"]') as NodeListOf<HTMLInputElement>;
    numberInputs[0].value = '100';
    numberInputs[0].dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(0);

    // Should show the "no matches" message, not the "no data" message
    const emptyState = fixture.nativeElement.querySelector('.swing-table-empty');
    expect(emptyState).toBeTruthy();
    expect(emptyState.textContent).toContain('No swings match the current filters');
    expect(emptyState.textContent).not.toContain('enter a symbol');
  });

  it('shows "no data" message when swings input is empty', () => {
    host.swings = [];
    fixture.detectChanges();

    const emptyState = fixture.nativeElement.querySelector('.swing-table-empty');
    expect(emptyState).toBeTruthy();
    expect(emptyState.textContent).toContain('enter a symbol');
  });

  // =========================================================================
  // Tree mode (dual mode) — nested parents + children
  // =========================================================================

  /** Standard tree fixture: 3 large swings, 3 small swings, 1 orphan. */
  function setupTree(): void {
    host.swings = [
      makeSwing({ start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 110, barIndex: 10 } }),
      makeSwing({ direction: 'down', start: { time: 1000, price: 110, barIndex: 10 }, end: { time: 2000, price: 100, barIndex: 20 } }),
      makeSwing({ start: { time: 2000, price: 100, barIndex: 20 }, end: { time: 3000, price: 115, barIndex: 30 }, confirmed: false }),
    ];
    host.smallSwings = [
      makeSwing({ start: { time: 200, price: 100, barIndex: 2 }, end: { time: 400, price: 103, barIndex: 4 }, duration: 2, magnitudePercent: 3 }),
      makeSwing({ direction: 'down', start: { time: 1200, price: 108, barIndex: 12 }, end: { time: 1400, price: 105, barIndex: 14 }, duration: 2, magnitudePercent: -2.7 }),
      makeSwing({ start: { time: 1500, price: 105, barIndex: 15 }, end: { time: 1700, price: 108, barIndex: 17 }, duration: 2, magnitudePercent: 2.8 }),
      makeSwing({ start: { time: 3500, price: 115, barIndex: 35 }, end: { time: 3800, price: 118, barIndex: 38 }, duration: 3 }), // orphan — after last parent
    ];
    fixture.detectChanges();
  }

  const parentRows = () => fixture.nativeElement.querySelectorAll('tr.parent-row') as NodeListOf<HTMLElement>;
  const childRows = () => fixture.nativeElement.querySelectorAll('tr.child-row') as NodeListOf<HTMLElement>;

  it('renders tree mode when smallSwings is bound — parent rows + expander column', () => {
    setupTree();
    expect(parentRows().length).toBe(4); // 3 parents + 1 orphan
    expect(fixture.nativeElement.querySelector('th.expander-col')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.expander-btn').length).toBe(2); // parents 1 and 2 have children
  });

  it('renders child rows under expanded parents by default', () => {
    setupTree();
    expect(childRows().length).toBe(3); // 1 child under parent 1, 2 under parent 2
    // Child numbering: parent.child
    const childIndexes = Array.from(childRows()).map((r) => r.querySelectorAll('td')[1].textContent!.trim());
    expect(childIndexes).toEqual(['1.1', '2.1', '2.2']);
  });

  it('collapses a parent row to hide its children, expands to restore', () => {
    setupTree();
    // Parent 2 (start.time=1000) is at merged position 1.
    const expander = fixture.nativeElement.querySelector('[data-testid="expander-1"]') as HTMLButtonElement;
    expect(expander).toBeTruthy();

    expander.click();
    fixture.detectChanges();
    expect(childRows().length).toBe(1); // parent 2's 2 children hidden

    expander.click();
    fixture.detectChanges();
    expect(childRows().length).toBe(3);
  });

  it('collapse-all hides all children; expand-all restores them', () => {
    setupTree();
    const toggleAll = fixture.nativeElement.querySelector('[data-testid="expand-collapse-all"]') as HTMLButtonElement;
    expect(toggleAll).toBeTruthy();
    expect(toggleAll.textContent).toContain('Collapse All');

    toggleAll.click();
    fixture.detectChanges();
    expect(childRows().length).toBe(0);
    expect(toggleAll.textContent).toContain('Expand All');

    toggleAll.click();
    fixture.detectChanges();
    expect(childRows().length).toBe(3);
    expect(toggleAll.textContent).toContain('Collapse All');
  });

  it('does not render the expand-all button when no parent has children', () => {
    host.swings = [makeSwing({ start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 110, barIndex: 10 } })];
    host.smallSwings = []; // tree mode but no children at all
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="expand-collapse-all"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.expander-btn')).toBeNull();
  });

  it('renders orphan small swings as top-level rows with S index and no expander', () => {
    setupTree();
    const orphan = fixture.nativeElement.querySelector('tr.orphan-row') as HTMLElement;
    expect(orphan).toBeTruthy();
    const cells = orphan.querySelectorAll('td');
    expect(cells[1].textContent!.trim()).toBe('S1');
    expect(orphan.querySelector('.expander-btn')).toBeNull();
  });

  it('sorts top-level rows only — children stay chronological under their parent', () => {
    setupTree();
    // Sort by magnitude % desc (col index 6 in tree mode: expander=0, #=1, dir=2, start=3, end=4, dur=5, mag%=6)
    const headers = fixture.nativeElement.querySelectorAll('thead th');
    (headers[6] as HTMLElement).click();
    fixture.detectChanges();

    const rows = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLElement[];
    // Parent order by magnitudePercent desc: +10 (parent1), 0-ish (orphan +10%? orphan has magnitudePercent 10 default)
    // Large swings: +10, -10 (down), +15 (unconfirmed). Orphan: +10.
    // Just verify every child row immediately follows its parent and children keep [1200,1500] order.
    const parent2Idx = rows.findIndex((r) => r.querySelectorAll('td')[1].textContent!.trim() === '2');
    expect(rows[parent2Idx + 1].classList.contains('child-row')).toBe(true);
    expect(rows[parent2Idx + 2].classList.contains('child-row')).toBe(true);
    const childTimes = [rows[parent2Idx + 1], rows[parent2Idx + 2]].map(
      (r) => r.querySelectorAll('td')[1].textContent!.trim(),
    );
    expect(childTimes).toEqual(['2.1', '2.2']);
  });

  it('applies direction filter to top-level rows only — children stay attached', () => {
    setupTree();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'up';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // Up parents: parent1 (up), parent3 (up, unconfirmed), orphan (up). Parent2 (down) filtered out — its children too.
    expect(parentRows().length).toBe(3);
    expect(childRows().length).toBe(1); // only parent1's child
  });

  it('marks unconfirmed child rows with projected styling', () => {
    host.swings = [makeSwing({ start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 110, barIndex: 10 } })];
    host.smallSwings = [
      makeSwing({ start: { time: 200, price: 100, barIndex: 2 }, end: { time: 400, price: 103, barIndex: 4 }, confirmed: true }),
      makeSwing({ start: { time: 500, price: 103, barIndex: 5 }, end: { time: 800, price: 108, barIndex: 8 }, confirmed: false }),
    ];
    fixture.detectChanges();

    const children = childRows();
    expect(children.length).toBe(2);
    expect(children[0].classList.contains('projected')).toBe(false);
    expect(children[1].classList.contains('projected')).toBe(true);
  });

  it('reverts to flat view when smallSwings returns to null', () => {
    setupTree();
    expect(fixture.nativeElement.querySelector('th.expander-col')).toBeTruthy();

    // setInput marks the host view dirty — a plain field mutation doesn't
    // notify zoneless CD and trips NG0100 on checkNoChanges.
    fixture.componentRef.setInput('smallSwings', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('th.expander-col')).toBeNull();
    expect(childRows().length).toBe(0);
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3); // flat — just the 3 large swings
  });

  it('renders orphan-only tree when there are no large swings', () => {
    host.swings = [];
    host.smallSwings = [makeSwing({ start: { time: 100, price: 100, barIndex: 1 }, end: { time: 300, price: 105, barIndex: 3 } })];
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].classList.contains('orphan-row')).toBe(true);
  });

  it('clears collapse state when the swings dataset changes', () => {
    setupTree();
    const expander = fixture.nativeElement.querySelector('[data-testid="expander-1"]') as HTMLButtonElement;
    expander.click();
    fixture.detectChanges();
    expect(childRows().length).toBe(1); // parent 2 collapsed

    // Simulate a new dataset (e.g., symbol switch) — same timestamps, new array.
    fixture.componentRef.setInput('swings', [
      makeSwing({ start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 110, barIndex: 10 } }),
      makeSwing({ direction: 'down', start: { time: 1000, price: 110, barIndex: 10 }, end: { time: 2000, price: 100, barIndex: 20 } }),
      makeSwing({ start: { time: 2000, price: 100, barIndex: 20 }, end: { time: 3000, price: 115, barIndex: 30 }, confirmed: false }),
    ]);
    fixture.detectChanges();

    // The parent at the same position must NOT inherit the old collapsed state.
    expect(childRows().length).toBe(3);
  });

  it('renders zero-duration parents sharing a start.time without crashing', () => {
    // allowZigZagOnOneBar can produce a pivot high+low on the same bar →
    // a zero-duration swing whose start.time equals the next swing's start.
    // Rows must stay distinct (no NG0955 duplicate track keys).
    host.swings = [
      makeSwing({ start: { time: 0, price: 100, barIndex: 0 }, end: { time: 1000, price: 110, barIndex: 10 } }),
      makeSwing({ direction: 'down', start: { time: 1000, price: 110, barIndex: 10 }, end: { time: 1000, price: 105, barIndex: 10 }, duration: 0 }),
      makeSwing({ start: { time: 1000, price: 105, barIndex: 10 }, end: { time: 2000, price: 115, barIndex: 20 } }),
    ];
    host.smallSwings = [
      makeSwing({ start: { time: 1000, price: 105, barIndex: 10 }, end: { time: 1100, price: 108, barIndex: 11 } }),
    ];
    fixture.detectChanges();

    // Two parents share start.time=1000 — both render as distinct rows.
    expect(parentRows().length).toBe(3);
    // The small at t=1000 assigns to the LATER parent (index 2 in merged order).
    const expander = fixture.nativeElement.querySelector('[data-testid="expander-2"]');
    expect(expander).toBeTruthy();
    expect(childRows().length).toBe(1);
  });
});
