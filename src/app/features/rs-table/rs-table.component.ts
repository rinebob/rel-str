import { Component, Input, ChangeDetectionStrategy, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { HttpClient } from '@angular/common/http';
import { forkJoin, of, type Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { generatePercentChangeData, addColorToRank, calculateRank, StockDatum, RsTableRow, PercentChangeDatum, getDateAndValue, buildWindow } from '../utils/rs';
import { generateColorArray } from '../utils/color-utils';

// Column typing to keep TS and template in sync
export type RsTableColumn = 'date' | 'qqqValue' | 'qqqPct' | 'msftValue' | 'msftPct' | 'msftRs';
export const RS_TABLE_COLUMNS: ReadonlyArray<RsTableColumn> = ['date','qqqValue','qqqPct','msftValue','msftPct','msftRs'] as const;

/**
 * Standalone component to display RS comparison table for QQQ and MSFT using Syncfusion DataGrid.
 * Columns: date, qqq value, qqq pct change, msft value, msft pct change, msft RS (optimized)
 */
@Component({
  selector: 'rs-table',
  standalone: true,
  imports: [CommonModule, MatTableModule],
  // NOTE: HttpClient must be provided at the app root (main.ts) via provideHttpClient()
  templateUrl: './rs-table.component.html',
  styleUrls: ['./rs-table.component.scss'],

  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RsTableComponent {
  @Input() msftData: StockDatum[] = [];
  @Input() qqqData: StockDatum[] = [];
  @Input() heatmapColors: string[] = [];

  tableData = signal<RsTableRow[]>([]);
  loading = signal<boolean>(false);
  error = signal<string | null>(null);
  // Expose typed columns to template
  readonly displayedColumns = RS_TABLE_COLUMNS;
  // Avoid getters in templates: expose as computed signal
  readonly totalRows = computed(() => this.tableData().length);

  private http = inject(HttpClient);

  ngOnInit() {
    // If no data provided, load from CSVs
    if (!this.msftData.length || !this.qqqData.length) {
      this.loadCSVsAndCalculate();
    } else {
      this.prepareTableData();
    }
  }

  ngOnChanges() {
    this.prepareTableData();
  }

  /**
   * Loads MSFT and QQQ CSVs, parses them, and runs RS calculations.
   */
  private loadCSVsAndCalculate() {
    this.loading.set(true);
    const msftUrl = '/assets/data/BATS_MSFT, 1D_0d494.csv';
    const qqqUrl = '/assets/data/BATS_QQQ, 1D_862dd.csv';
    // Use forkJoin to load both CSVs as observables
    forkJoin<[
      string,
      string
    ]>([
      this.http.get(msftUrl, { responseType: 'text' }) as Observable<string>,
      this.http.get(qqqUrl, { responseType: 'text' }) as Observable<string>
    ]).pipe(
      catchError((err: unknown) => {
        this.error.set('Failed to load CSVs: ' + String(err));
        this.loading.set(false);
        return of([undefined, undefined] as unknown as [string, string]);
      })
    ).subscribe((result: [string, string]) => {
      const msftCsv = result[0] ?? '';
      const qqqCsv = result[1] ?? '';
      console.log('[RS Table] HTTP requests complete. msftCsv length:', msftCsv.length, 'qqqCsv length:', qqqCsv.length);
      if (!msftCsv || !qqqCsv) {
        this.error.set('CSV data could not be loaded or is invalid.');
        this.loading.set(false);
        return;
      }
      try {
        console.log('[RS Table] Raw MSFT CSV sample:', msftCsv.slice(0, 200));
        console.log('[RS Table] Raw QQQ CSV sample:', qqqCsv.slice(0, 200));
        this.msftData = this.parseCsvToDailyClose(msftCsv);
        this.qqqData = this.parseCsvToDailyClose(qqqCsv);
        if (!this.heatmapColors.length) {
          this.heatmapColors = generateColorArray(11);
        }
        this.prepareTableData();
        console.log('[RS Table] Table data set:', this.tableData());
      } catch (parseErr) {
        this.error.set('Error parsing CSV: ' + (parseErr instanceof Error ? parseErr.message : String(parseErr)));
        console.error('[RS Table] Error parsing CSV:', parseErr);
      }
      this.loading.set(false);
    });
  }

  /**
   * Parses CSV string to array of {date: close} objects.
   */
  private parseCsvToDailyClose(csv: string): StockDatum[] {
    const lines = csv.split(/\r?\n/).filter(l => l && !l.startsWith('timestamp'));
    const parsed: StockDatum[] = [];
    for (const line of lines) {
      const [timestamp, open, high, low, close] = line.split(',');
      if (!timestamp || isNaN(Number(timestamp))) {
        console.warn('[RS Table] Skipping invalid CSV line (bad timestamp):', line);
        continue;
      }
      const date = new Date(Number(timestamp) * 1000);
      if (isNaN(date.getTime())) {
        console.warn('[RS Table] Skipping invalid CSV line (bad date):', line);
        continue;
      }
      parsed.push({ [date.toISOString().slice(0, 10)]: +close });
    }
    return parsed;
  }

  /**
   * Prepares the table data for the RS table.
   */
  prepareTableData() {
    if (!this.msftData?.length || !this.qqqData?.length) {
      this.tableData.set([] as RsTableRow[]);
      return;
    }
    const qqqPct: ReadonlyArray<PercentChangeDatum> = generatePercentChangeData(this.qqqData);
    const msftPct: ReadonlyArray<PercentChangeDatum> = generatePercentChangeData(this.msftData);
    const rows: RsTableRow[] = [];
    for (let i = 5; i < this.msftData.length; i++) {
      const { date, value: msftValue } = getDateAndValue(this.msftData[i]);
      const { value: qqqValue } = getDateAndValue(this.qqqData[i]);
      const msftPctVal = msftPct[i-1]?.value ?? null;
      const qqqPctVal = qqqPct[i-1]?.value ?? null;
      // Build rolling window for RS calculation (fixed-size tuple)
      const msftWindow = buildWindow(msftPct, i);
      const qqqWindow = buildWindow(qqqPct, i);
      // Calculate RS using optimized method only
      const rsVal = (msftWindow && qqqWindow)
        ? calculateRank(msftWindow, qqqWindow)
        : null;
      // Color (optional, can use addColorToRank if needed)
      const rsColor = rsVal != null ? addColorToRank({ value: rsVal, date }, this.heatmapColors).color : null;
      rows.push({
        date,
        msftValue,
        qqqValue,
        msftPct: msftPctVal,
        qqqPct: qqqPctVal,
        msftRs: rsVal,
        msftRsColor: rsColor,
      });
    }
    this.tableData.set(rows);
  }
}
