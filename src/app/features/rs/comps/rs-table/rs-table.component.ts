import { Component, Input, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { HttpClient } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { generatePercentChangeData, generateTargetRanksData } from '../../utils/rs-calc-utils';
import { generateTargetRanksDataOptimized } from '../../utils/rs-calc-utils-optimized';
import { generateColorArray } from '../../utils/color-utils';
import { StringNumberObject } from '../../common/interfaces-rs';

/**
 * Standalone component to display RS comparison table for QQQ and MSFT using Syncfusion DataGrid.
 * Columns: date, qqq value, qqq pct change, msft value, msft pct change, msft RS (method 1), msft RS (method 2)
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
  @Input() msftData: any[] = [];
  @Input() qqqData: any[] = [];
  @Input() heatmapColors: string[] = [];

  tableData = signal<any[]>([]);
  loading = signal<boolean>(false);
  error = signal<string | null>(null);

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
    forkJoin([
      this.http.get(msftUrl, { responseType: 'text' }) as import('rxjs').Observable<string>,
      this.http.get(qqqUrl, { responseType: 'text' }) as import('rxjs').Observable<string>
    ]).pipe(
      catchError((err: unknown) => {
        this.error.set('Failed to load CSVs: ' + String(err));
        this.loading.set(false);
        return of([undefined, undefined]);
      })
    ).subscribe((result: (string | undefined)[]) => {
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
        this.error.set('Error parsing CSV: ' + (parseErr instanceof Error ? parseErr.message : parseErr));
        console.error('[RS Table] Error parsing CSV:', parseErr);
      }
      this.loading.set(false);
    });
  }

  /**
   * Parses CSV string to array of {date: close} objects.
   */
  private parseCsvToDailyClose(csv: string): any[] {
    const lines = csv.split(/\r?\n/).filter(l => l && !l.startsWith('timestamp'));
    const parsed = [];
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
      this.tableData.set([]);
      return;
    }
    const qqqPct = generatePercentChangeData(this.qqqData);
    const msftPct = generatePercentChangeData(this.msftData);
    // Method 1: Original
    const msftRs1 = generateTargetRanksData(qqqPct, msftPct, this.heatmapColors);
    // Method 2: Optimized
    const msftRs2 = generateTargetRanksDataOptimized(qqqPct, msftPct, this.heatmapColors);

    // Align by date (skip first day, as pct change is undefined)
    const rows = [];
    for (let i = 1; i < this.msftData.length; i++) {
      const date = Object.keys(this.msftData[i])[0];
      const msftValue = Object.values(this.msftData[i])[0];
      const qqqValue = Object.values(this.qqqData[i])[0];
      rows.push({
        date,
        qqqValue,
        qqqPct: qqqPct[i - 1]?.value ?? null,
        msftValue,
        msftPct: msftPct[i - 1]?.value ?? null,
        msftRs1: msftRs1[i - 1]?.value ?? null,
        msftRs1Color: msftRs1[i - 1]?.color ?? null,
        msftRs2: msftRs2[i - 1]?.value ?? null,
        msftRs2Color: msftRs2[i - 1]?.color ?? null,
        rsDiff: msftRs1[i - 1]?.value != null && msftRs2[i - 1]?.value != null
          ? msftRs1[i - 1].value - msftRs2[i - 1].value
          : null,
      });
    }
    this.tableData.set(rows);
  }

  /**
   * Returns the total number of rows in the table.
   */
  public get totalRows(): number {
    return this.tableData()?.length ?? 0;
  }

  /**
   * Returns the number of rows where rsDiff is not null and not zero.
   */
  public get rowsWithDiff(): number {
    return (this.tableData() ?? []).filter(row => row.rsDiff != null && row.rsDiff !== 0).length;
  }
}
