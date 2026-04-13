# RS-FE-HEATMAP-CHART: RS Heatmap Chart View Implementation

## 1. Overview

**Feature**: RS Heatmap Chart View  
**Planning Doc**: `docs/planning/2.6_RS_HEATMAP_CHART_CORRELATION.md`  
**Status**: Not Started  
**Priority**: Medium  
**Estimated Effort**: 3-5 days

### Purpose

Implement a new analytical view that displays a price chart synchronized with aligned RS heatmap cells below. This allows users to visually correlate RS values at different timeframes (Daily, Weekly, Monthly) with price action to identify potential trade entry points.

### Key Requirements

- Perfect vertical alignment between chart bars and heatmap cells
- Multi-timeframe support (D/W/M) with synchronized switching
- Single-pair focus (accessed from main heatmap row click)
- Minimal heatmap display (colors only, no values in cells)
- Cell spanning for Weekly/Monthly when Daily chart is shown

## 2. Technical Architecture

### 2.1 Component Structure

```
src/app/features/heatmap-chart/
├── components/
│   ├── heatmap-chart-view/
│   │   ├── heatmap-chart-view.component.ts
│   │   ├── heatmap-chart-view.component.html
│   │   ├── heatmap-chart-view.component.scss
│   │   └── heatmap-chart-view.component.spec.ts
│   ├── heatmap-chart-chart/
│   │   ├── heatmap-chart-chart.component.ts
│   │   ├── heatmap-chart-chart.component.html
│   │   ├── heatmap-chart-chart.component.scss
│   │   └── heatmap-chart-chart.component.spec.ts
│   ├── heatmap-chart-heatmap/
│   │   ├── heatmap-chart-heatmap.component.ts
│   │   ├── heatmap-chart-heatmap.component.html
│   │   ├── heatmap-chart-heatmap.component.scss
│   │   └── heatmap-chart-heatmap.component.spec.ts
│   ├── timeframe-selector/
│   │   ├── timeframe-selector.component.ts
│   │   ├── timeframe-selector.component.html
│   │   ├── timeframe-selector.component.scss
│   │   └── timeframe-selector.component.spec.ts
│   └── list-navigator/
│       ├── list-navigator.component.ts
│       ├── list-navigator.component.html
│       ├── list-navigator.component.scss
│       └── list-navigator.component.spec.ts
├── services/
│   ├── heatmap-chart-data.service.ts
│   └── heatmap-chart-data.service.spec.ts
├── store/
│   ├── heatmap-chart.store.ts
│   └── heatmap-chart.store.spec.ts
├── models/
│   └── heatmap-chart.types.ts
└── utils/
    ├── alignment-calculator.ts
    └── alignment-calculator.spec.ts
```

### 2.2 Route Configuration

Add to `src/app/app.routes.ts`:

```typescript
{
  path: 'heatmap-chart/:baseline/:symbol',
  loadComponent: () => 
    import('./features/heatmap-chart/components/heatmap-chart-view/heatmap-chart-view.component')
      .then(m => m.HeatmapChartViewComponent),
  canActivate: [authGuard]
}
```

### 2.3 Type Definitions

Create `src/app/features/heatmap-chart/models/heatmap-chart.types.ts`:

```typescript
export interface HeatmapChartQuery {
  baseline: string;
  symbol: string;
  dateRange: DateRange;
  listContext?: {
    listId: string;
    pairIds: string[];  // All pairs in current list for navigation
    currentIndex: number;
  };
}

export interface DateRange {
  from: string; // ISO date string
  to: string;   // ISO date string
}

export interface RsDataPoint {
  date: string;              // ISO date (period start or end)
  rsRaw: number | null;      // RS value 0-100
  phase?: 'pre' | 'post';    // Only 'pre' for current day; all historical = 'post'
}

export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HeatmapChartData {
  ohlcv: OhlcvBar[];
  rsDaily: RsDataPoint[];
  rsWeekly: RsDataPoint[];
  rsMonthly: RsDataPoint[];
}

export type TimeframeInterval = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface HeatmapChartState {
  query: HeatmapChartQuery | null;
  data: HeatmapChartData | null;
  selectedTimeframe: TimeframeInterval;
  colorScheme: string;  // Support dashboard-v3 dynamic coloring
  status: 'idle' | 'loading' | 'ready' | 'error';
  errorMessage?: string;
}

export interface HeatmapRowData {
  interval: TimeframeInterval;
  rsData: RsDataPoint[];
  visible: boolean;
}

export interface AlignmentMetadata {
  barWidth: number;
  chartWidth: number;
  bars: ChartBarPosition[];
  heatmapCells: HeatmapCellPosition[];
}

export interface ChartBarPosition {
  index: number;
  date: string;
  x: number;
  width: number;
}

export interface HeatmapCellPosition {
  interval: TimeframeInterval;
  dateStart: string;
  dateEnd: string;
  rsValue: number | null;
  x: number;
  width: number;
  barIndices: number[]; // Which chart bars this cell spans
}
```

## 3. Implementation Steps

### Phase 1: Core Infrastructure (Day 1)

#### Step 1.1: Create Type Definitions

- Create `rs-correlation.types.ts` with all interfaces defined above
- Export types from a barrel file

#### Step 1.2: Create Data Service

Create `src/app/features/heatmap-chart/services/heatmap-chart-data.service.ts`:

```typescript
import { inject, Injectable } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { RelStrDbV2Service } from '@core/services/rel-str-db-v2.service';
import { HeatmapChartQuery, HeatmapChartData, RsDataPoint } from '../models/heatmap-chart.types';

@Injectable({ providedIn: 'root' })
export class HeatmapChartDataService {
  private readonly dbService = inject(RelStrDbV2Service);

  /**
   * Fetch all data needed for heatmap chart view:
   * - OHLCV from backend callable
   * - RS series for Daily, Weekly, Monthly intervals (all at once, no lazy loading)
   */
  getHeatmapChartData$(query: HeatmapChartQuery): Observable<HeatmapChartData> {
    const pairId = `${query.baseline}_${query.symbol}`;
    
    // Fetch RS data for all three intervals in parallel
    const rsDaily$ = this.fetchRsSeries$(pairId, 'DAILY', query.dateRange);
    const rsWeekly$ = this.fetchRsSeries$(pairId, 'WEEKLY', query.dateRange);
    const rsMonthly$ = this.fetchRsSeries$(pairId, 'MONTHLY', query.dateRange);
    
    // Fetch OHLCV from backend callable
    const ohlcv$ = this.fetchOhlcv$(query.baseline, query.symbol, query.dateRange);

    return combineLatest([ohlcv$, rsDaily$, rsWeekly$, rsMonthly$]).pipe(
      map(([ohlcv, rsDaily, rsWeekly, rsMonthly]) => ({
        ohlcv,
        rsDaily,
        rsWeekly,
        rsMonthly
      }))
    );
  }

  /**
   * Fetch RS series for a specific interval from Firestore
   * Primary: Use heatmap-snapshots collection for efficiency
   * Fallback: Read from pairs-data/{pairId}/archive-* documents
   * Paths: archive-* (daily), archive-weekly-* (weekly), archive-monthly-* (monthly)
   */
  private fetchRsSeries$(
    pairId: string,
    interval: 'DAILY' | 'WEEKLY' | 'MONTHLY',
    dateRange: DateRange
  ): Observable<RsDataPoint[]> {
    // TODO: Implement heatmap-snapshots fetch first, then fallback to pairs-data
    // For now, use pairs-data archive documents
    const archivePrefix = interval === 'DAILY' ? 'archive-' : 
                         interval === 'WEEKLY' ? 'archive-weekly-' : 'archive-monthly-';
    
    return this.dbService.getPairSeriesFromArchiveWindow$(
      pairId,
      interval,
      dateRange.from,
      dateRange.to
    ).pipe(
      map(series => series.map(point => ({
        date: point.date,
        rsRaw: point.rsRaw,
        // Only current day can have 'pre' phase; all historical = 'post'
        phase: this.isCurrentDay(point.date) ? point.phase : 'post'
      })))
    );
  }

  private isCurrentDay(dateStr: string): boolean {
    const today = new Date().toISOString().split('T')[0];
    return dateStr === today;
  }

  /**
   * Fetch OHLCV data via backend callable
   * Reuses existing callable infrastructure
   */
  private fetchOhlcv$(
    baseline: string,
    symbol: string,
    dateRange: DateRange
  ): Observable<OhlcvBar[]> {
    // Call existing backend callable for OHLCV
    // This should reuse the same callable used by rs-chart view
    return this.dbService.getOhlcvData$(baseline, symbol, dateRange.from, dateRange.to);
  }
}
```

#### Step 1.3: Create Signal Store

Create `src/app/features/heatmap-chart/store/heatmap-chart.store.ts`:

```typescript
import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of } from 'rxjs';
import { HeatmapChartDataService } from '../services/heatmap-chart-data.service';
import { 
  HeatmapChartState, 
  HeatmapChartQuery, 
  TimeframeInterval,
  HeatmapRowData,
  DateRange
} from '../models/heatmap-chart.types';

const initialState: HeatmapChartState = {
  query: null,
  data: null,
  selectedTimeframe: 'DAILY',
  colorScheme: 'default',  // Will integrate dashboard-v3 color schemes
  status: 'idle',
  errorMessage: undefined
};

export const HeatmapChartStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    // Determine which heatmap rows are visible based on selected timeframe
    visibleHeatmapRows: computed((): HeatmapRowData[] => {
      const data = store.data();
      const tf = store.selectedTimeframe();
      if (!data) return [];

      const rows: HeatmapRowData[] = [
        { interval: 'DAILY', rsData: data.rsDaily, visible: tf === 'DAILY' },
        { interval: 'WEEKLY', rsData: data.rsWeekly, visible: tf === 'DAILY' || tf === 'WEEKLY' },
        { interval: 'MONTHLY', rsData: data.rsMonthly, visible: true }
      ];

      return rows;
    }),

    // Chart bars filtered/aggregated by selected timeframe
    chartBars: computed(() => {
      const data = store.data();
      const tf = store.selectedTimeframe();
      if (!data) return [];

      // For MVP, return daily OHLCV as-is
      // TODO: Implement aggregation for WEEKLY/MONTHLY in Phase 2
      return data.ohlcv;
    }),

    isLoading: computed(() => store.status() === 'loading'),
    isReady: computed(() => store.status() === 'ready'),
    hasError: computed(() => store.status() === 'error')
  })),
  withMethods((store, dataService = inject(HeatmapChartDataService)) => ({
    // Load heatmap chart data for a baseline-symbol pair
    loadData: rxMethod<{ baseline: string; symbol: string; dateRange: DateRange; listContext?: any }>(
      pipe(
        tap(() => patchState(store, { status: 'loading', errorMessage: undefined })),
        switchMap(({ baseline, symbol, dateRange, listContext }) => {
          const query: HeatmapChartQuery = { baseline, symbol, dateRange, listContext };
          patchState(store, { query });

          return dataService.getHeatmapChartData$(query).pipe(
            tap(data => {
              patchState(store, { 
                data, 
                status: 'ready',
                errorMessage: undefined
              });
            }),
            catchError(error => {
              patchState(store, { 
                status: 'error', 
                errorMessage: error.message || 'Failed to load heatmap chart data'
              });
              return of(null);
            })
          );
        })
      )
    ),

    // Update selected timeframe (no refetch needed)
    setTimeframe(tf: TimeframeInterval) {
      patchState(store, { selectedTimeframe: tf });
    },

    // Update date range and refetch data
    updateDateRange: rxMethod<DateRange>(
      pipe(
        tap(() => patchState(store, { status: 'loading' })),
        switchMap(dateRange => {
          const query = store.query();
          if (!query) return of(null);

          const updatedQuery = { ...query, dateRange };
          patchState(store, { query: updatedQuery });

          return dataService.getHeatmapChartData$(updatedQuery).pipe(
            tap(data => {
              patchState(store, { data, status: 'ready' });
            }),
            catchError(error => {
              patchState(store, { 
                status: 'error', 
                errorMessage: error.message 
              });
              return of(null);
            })
          );
        })
      )
    ),

    // Navigate to next/previous pair in list
    navigateToPair(direction: 'next' | 'prev') {
      const query = store.query();
      if (!query?.listContext) return;

      const { pairIds, currentIndex } = query.listContext;
      const newIndex = direction === 'next' 
        ? Math.min(currentIndex + 1, pairIds.length - 1)
        : Math.max(currentIndex - 1, 0);

      if (newIndex === currentIndex) return;

      const newPairId = pairIds[newIndex];
      const [baseline, symbol] = newPairId.split('_');
      
      // Reload data for new pair
      this.loadData({ 
        baseline, 
        symbol, 
        dateRange: query.dateRange,
        listContext: { ...query.listContext, currentIndex: newIndex }
      });
    },

    // Update color scheme (dashboard-v3 integration)
    setColorScheme(scheme: string) {
      patchState(store, { colorScheme: scheme });
    },

    reset() {
      patchState(store, initialState);
    }
  }))
);
```

### Phase 2: View Components (Day 2)

#### Step 2.1: Create Top-Level View Component

Create `src/app/features/heatmap-chart/components/heatmap-chart-view/heatmap-chart-view.component.ts`:

```typescript
import { Component, OnInit, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HeatmapChartStore } from '../../store/heatmap-chart.store';
import { HeatmapChartChartComponent } from '../heatmap-chart-chart/heatmap-chart-chart.component';
import { HeatmapChartHeatmapComponent } from '../heatmap-chart-heatmap/heatmap-chart-heatmap.component';
import { ListNavigatorComponent } from '../list-navigator/list-navigator.component';
import { TimeframeSelectorComponent } from '../timeframe-selector/timeframe-selector.component';
import { DateRange } from '../../models/heatmap-chart.types';

@Component({
  selector: 'app-heatmap-chart-view',
  standalone: true,
  imports: [
    CommonModule,
    HeatmapChartChartComponent,
    HeatmapChartHeatmapComponent,
    TimeframeSelectorComponent,
    ListNavigatorComponent
  ],
  templateUrl: './heatmap-chart-view.component.html',
  styleUrl: './heatmap-chart-view.component.scss'
})
export class HeatmapChartViewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  readonly store = inject(HeatmapChartStore);

  ngOnInit(): void {
    // Extract baseline and symbol from route params
    const baseline = this.route.snapshot.paramMap.get('baseline');
    const symbol = this.route.snapshot.paramMap.get('symbol');

    if (!baseline || !symbol) {
      console.error('Missing baseline or symbol in route params');
      return;
    }

    // Use same defaults as rs-chart view
    // TODO: Import default date range from rs-chart configuration
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - 6);  // Placeholder - sync with rs-chart defaults

    const dateRange: DateRange = {
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0]
    };

    // Load data with optional list context for navigation
    // TODO: Get list context from route state or query params
    this.store.loadData({ baseline, symbol, dateRange });
  }
}
```

Create `heatmap-chart-view.component.html`:

```html
<div class="heatmap-chart-view">
  <!-- Header -->
  <div class="heatmap-chart-header">
    <h2 class="pair-title">
      {{ store.query()?.baseline }} / {{ store.query()?.symbol }}
    </h2>
    
    <div class="header-controls">
      <app-list-navigator
        [currentIndex]="store.query()?.listContext?.currentIndex ?? 0"
        [totalCount]="store.query()?.listContext?.pairIds?.length ?? 1"
        [canNavigatePrev]="(store.query()?.listContext?.currentIndex ?? 0) > 0"
        [canNavigateNext]="(store.query()?.listContext?.currentIndex ?? 0) < ((store.query()?.listContext?.pairIds?.length ?? 1) - 1)"
        (navigatePrev)="store.navigateToPair('prev')"
        (navigateNext)="store.navigateToPair('next')"
      />
      
      <app-timeframe-selector
        [selectedTimeframe]="store.selectedTimeframe()"
        (timeframeChange)="store.setTimeframe($event)"
      />
    </div>
  </div>

  <!-- Loading State -->
  @if (store.isLoading()) {
    <div class="loading-container">
      <mat-spinner diameter="50"></mat-spinner>
      <p>Loading heatmap chart data...</p>
    </div>
  }

  <!-- Error State -->
  @if (store.hasError()) {
    <div class="error-container">
      <mat-icon>error</mat-icon>
      <p>{{ store.errorMessage() }}</p>
    </div>
  }

  <!-- Ready State -->
  @if (store.isReady()) {
    <div class="heatmap-chart-content">
      <!-- Chart Area -->
      <app-heatmap-chart-chart
        [chartBars]="store.chartBars()"
        [selectedTimeframe]="store.selectedTimeframe()"
      />

      <!-- Heatmap Area -->
      <app-heatmap-chart-heatmap
        [heatmapRows]="store.visibleHeatmapRows()"
        [chartBars]="store.chartBars()"
        [selectedTimeframe]="store.selectedTimeframe()"
        [colorScheme]="store.colorScheme()"
      />
    </div>
  }
</div>
```

Create `heatmap-chart-view.component.scss`:

```scss
@use '@styles/mixins' as *;
@use '@styles/variables' as *;

.heatmap-chart-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: rem(16);
  gap: rem(16);
}

.heatmap-chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: rem(16);
  background: var(--surface-color);
  border-radius: rem(8);
}

.pair-title {
  margin: 0;
  font-size: rem(24);
  font-weight: 600;
}

.loading-container,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: rem(48);
  gap: rem(16);
}

.error-container {
  color: var(--error-color);
  
  mat-icon {
    font-size: rem(48);
    width: rem(48);
    height: rem(48);
  }
}

.header-controls {
  display: flex;
  align-items: center;
  gap: rem(16);
}

.heatmap-chart-content {
  display: flex;
  flex-direction: column;
  gap: rem(8);
  flex: 1;
  min-height: 0; // Allow flex children to shrink
}
```

#### Step 2.2: Create Timeframe Selector Component

#### Step 2.2.1: Create List Navigator Component

Create `src/app/features/heatmap-chart/components/list-navigator/list-navigator.component.ts`:

```typescript
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-list-navigator',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './list-navigator.component.html',
  styleUrl: './list-navigator.component.scss'
})
export class ListNavigatorComponent {
  currentIndex = input.required<number>();
  totalCount = input.required<number>();
  canNavigatePrev = input.required<boolean>();
  canNavigateNext = input.required<boolean>();
  
  navigatePrev = output<void>();
  navigateNext = output<void>();
}
```

Create `list-navigator.component.html`:

```html
<div class="list-navigator">
  <button 
    mat-icon-button 
    [disabled]="!canNavigatePrev()"
    (click)="navigatePrev.emit()"
    aria-label="Previous pair"
  >
    <mat-icon>chevron_left</mat-icon>
  </button>
  
  <span class="position-indicator">
    {{ currentIndex() + 1 }} of {{ totalCount() }}
  </span>
  
  <button 
    mat-icon-button 
    [disabled]="!canNavigateNext()"
    (click)="navigateNext.emit()"
    aria-label="Next pair"
  >
    <mat-icon>chevron_right</mat-icon>
  </button>
</div>
```

Create `list-navigator.component.scss`:

```scss
@use '@styles/mixins' as *;

.list-navigator {
  display: flex;
  align-items: center;
  gap: rem(8);
}

.position-indicator {
  font-size: rem(14);
  color: var(--text-secondary);
  min-width: rem(60);
  text-align: center;
}
```

#### Step 2.2.2: Create Timeframe Selector Component

Create `src/app/features/heatmap-chart/components/timeframe-selector/timeframe-selector.component.ts`:

```typescript
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { TimeframeInterval } from '../../models/heatmap-chart.types';

@Component({
  selector: 'app-timeframe-selector',
  standalone: true,
  imports: [CommonModule, MatButtonToggleModule],
  templateUrl: './timeframe-selector.component.html',
  styleUrl: './timeframe-selector.component.scss'
})
export class TimeframeSelectorComponent {
  selectedTimeframe = input.required<TimeframeInterval>();
  timeframeChange = output<TimeframeInterval>();

  readonly timeframes: TimeframeInterval[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

  onTimeframeChange(tf: TimeframeInterval): void {
    this.timeframeChange.emit(tf);
  }
}
```

Create `timeframe-selector.component.html`:

```html
<mat-button-toggle-group
  [value]="selectedTimeframe()"
  (change)="onTimeframeChange($event.value)"
  aria-label="Select timeframe"
>
  <mat-button-toggle value="DAILY">D</mat-button-toggle>
  <mat-button-toggle value="WEEKLY">W</mat-button-toggle>
  <mat-button-toggle value="MONTHLY">M</mat-button-toggle>
</mat-button-toggle-group>
```

### Phase 3: Chart Component (Day 3)

#### Step 3.1: Create Chart Component Stub

Create `src/app/features/heatmap-chart/components/heatmap-chart-chart/heatmap-chart-chart.component.ts`:

```typescript
import { Component, input, OnInit, ElementRef, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OhlcvBar, TimeframeInterval } from '../../models/heatmap-chart.types';

@Component({
  selector: 'app-heatmap-chart-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './heatmap-chart-chart.component.html',
  styleUrl: './heatmap-chart-chart.component.scss'
})
export class HeatmapChartChartComponent implements OnInit {
  chartBars = input.required<OhlcvBar[]>();
  selectedTimeframe = input.required<TimeframeInterval>();

  @ViewChild('chartContainer', { static: true }) 
  chartContainer!: ElementRef<HTMLDivElement>;

  constructor() {
    // Re-render chart when inputs change
    effect(() => {
      const bars = this.chartBars();
      const tf = this.selectedTimeframe();
      if (bars.length > 0) {
        this.renderChart(bars, tf);
      }
    });
  }

  ngOnInit(): void {
    // Initial render will be triggered by effect
  }

  private renderChart(bars: OhlcvBar[], timeframe: TimeframeInterval): void {
    // TODO: Implement chart rendering
    // For MVP, reuse existing RsChartRenderService or similar
    // This is a placeholder for Phase 3 implementation
    console.log('Rendering chart with', bars.length, 'bars at', timeframe);
  }
}
```

Create `heatmap-chart-chart.component.html`:

```html
<div class="chart-wrapper">
  <div #chartContainer class="chart-container"></div>
</div>
```

Create `heatmap-chart-chart.component.scss`:

```scss
@use '@styles/mixins' as *;

.chart-wrapper {
  width: 100%;
  height: rem(400);
  background: var(--surface-color);
  border-radius: rem(8);
  padding: rem(16);
}

.chart-container {
  width: 100%;
  height: 100%;
}
```

### Phase 4: Heatmap Component with Alignment (Day 4-5)

#### Step 4.1: Create Alignment Calculator Utility

Create `src/app/features/heatmap-chart/utils/alignment-calculator.ts`:

```typescript
import { 
  OhlcvBar, 
  RsDataPoint, 
  TimeframeInterval,
  ChartBarPosition,
  HeatmapCellPosition,
  AlignmentMetadata
} from '../models/heatmap-chart.types';

export class AlignmentCalculator {
  /**
   * Calculate alignment metadata for chart bars and heatmap cells
   */
  static calculateAlignment(
    chartBars: OhlcvBar[],
    heatmapData: RsDataPoint[],
    heatmapInterval: TimeframeInterval,
    chartWidth: number
  ): AlignmentMetadata {
    const barWidth = chartWidth / chartBars.length;

    // Calculate chart bar positions
    const bars: ChartBarPosition[] = chartBars.map((bar, index) => ({
      index,
      date: bar.date,
      x: index * barWidth,
      width: barWidth
    }));

    // Calculate heatmap cell positions
    const cells = this.calculateCellPositions(
      chartBars,
      heatmapData,
      heatmapInterval,
      barWidth
    );

    return {
      barWidth,
      chartWidth,
      bars,
      heatmapCells: cells
    };
  }

  /**
   * Calculate heatmap cell positions and spanning
   */
  private static calculateCellPositions(
    chartBars: OhlcvBar[],
    heatmapData: RsDataPoint[],
    heatmapInterval: TimeframeInterval,
    barWidth: number
  ): HeatmapCellPosition[] {
    const cells: HeatmapCellPosition[] = [];

    for (const rsPoint of heatmapData) {
      // Find which chart bars belong to this RS period
      const barIndices = this.findBarsInPeriod(
        chartBars,
        rsPoint.date,
        heatmapInterval
      );

      if (barIndices.length === 0) continue;

      const firstBarIndex = barIndices[0];
      const lastBarIndex = barIndices[barIndices.length - 1];

      cells.push({
        interval: heatmapInterval,
        dateStart: chartBars[firstBarIndex].date,
        dateEnd: chartBars[lastBarIndex].date,
        rsValue: rsPoint.rsRaw,
        x: firstBarIndex * barWidth,
        width: barIndices.length * barWidth,
        barIndices
      });
    }

    return cells;
  }

  /**
   * Find chart bar indices that fall within an RS period
   */
  private static findBarsInPeriod(
    chartBars: OhlcvBar[],
    periodDate: string,
    interval: TimeframeInterval
  ): number[] {
    const indices: number[] = [];
    const periodStart = new Date(periodDate);

    for (let i = 0; i < chartBars.length; i++) {
      const barDate = new Date(chartBars[i].date);
      
      if (this.isBarInPeriod(barDate, periodStart, interval)) {
        indices.push(i);
      }
    }

    return indices;
  }

  /**
   * Check if a bar date falls within an RS period
   */
  private static isBarInPeriod(
    barDate: Date,
    periodStart: Date,
    interval: TimeframeInterval
  ): boolean {
    // For DAILY: exact match
    if (interval === 'DAILY') {
      return barDate.toISOString().split('T')[0] === periodStart.toISOString().split('T')[0];
    }

    // For WEEKLY: same week (Mon-Fri)
    if (interval === 'WEEKLY') {
      const weekStart = this.getWeekStart(periodStart);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return barDate >= weekStart && barDate <= weekEnd;
    }

    // For MONTHLY: same month and year
    if (interval === 'MONTHLY') {
      return barDate.getMonth() === periodStart.getMonth() &&
             barDate.getFullYear() === periodStart.getFullYear();
    }

    return false;
  }

  /**
   * Get the Monday of the week containing the given date
   */
  private static getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
    return new Date(d.setDate(diff));
  }

  /**
   * Get color for RS value using dashboard-v3 dynamic color scheme
   */
  static getRsColor(rsValue: number | null, colorScheme: string = 'default'): string {
    if (rsValue === null) return 'var(--neutral-color)';
    
    // TODO: Import and integrate dashboard-v3 color scale logic
    // This should support the same dynamic coloring variations as dashboard-v3
    // For now, simple gradient from red to green
    if (rsValue >= 70) return 'var(--rs-strong-green)';
    if (rsValue >= 60) return 'var(--rs-green)';
    if (rsValue >= 50) return 'var(--rs-light-green)';
    if (rsValue >= 40) return 'var(--rs-light-red)';
    if (rsValue >= 30) return 'var(--rs-red)';
    return 'var(--rs-strong-red)';
  }
}
```

#### Step 4.2: Create Heatmap Component

Create `src/app/features/heatmap-chart/components/heatmap-chart-heatmap/heatmap-chart-heatmap.component.ts`:

```typescript
import { 
  Component, 
  input, 
  computed, 
  ElementRef, 
  ViewChild, 
  effect,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { 
  HeatmapRowData, 
  OhlcvBar, 
  TimeframeInterval,
  AlignmentMetadata,
  HeatmapCellPosition
} from '../../models/heatmap-chart.types';
import { AlignmentCalculator } from '../../utils/alignment-calculator';

@Component({
  selector: 'app-heatmap-chart-heatmap',
  standalone: true,
  imports: [CommonModule, MatTooltipModule],
  templateUrl: './heatmap-chart-heatmap.component.html',
  styleUrl: './heatmap-chart-heatmap.component.scss'
})
export class HeatmapChartHeatmapComponent {
  heatmapRows = input.required<HeatmapRowData[]>();
  chartBars = input.required<OhlcvBar[]>();
  selectedTimeframe = input.required<TimeframeInterval>();
  colorScheme = input.required<string>();  // Dashboard-v3 color scheme

  @ViewChild('heatmapContainer', { static: true })
  heatmapContainer!: ElementRef<HTMLDivElement>;

  private chartWidth = signal(0);

  // Computed alignment metadata for each visible row
  readonly alignmentData = computed(() => {
    const rows = this.heatmapRows();
    const bars = this.chartBars();
    const width = this.chartWidth();

    if (!rows.length || !bars.length || width === 0) return [];

    return rows
      .filter(row => row.visible)
      .map(row => ({
        interval: row.interval,
        alignment: AlignmentCalculator.calculateAlignment(
          bars,
          row.rsData,
          row.interval,
          width
        )
      }));
  });

  constructor() {
    // Recalculate on resize
    effect(() => {
      this.updateChartWidth();
    });
  }

  ngAfterViewInit(): void {
    this.updateChartWidth();
    
    // Listen for window resize
    window.addEventListener('resize', () => this.updateChartWidth());
  }

  private updateChartWidth(): void {
    if (this.heatmapContainer) {
      const width = this.heatmapContainer.nativeElement.offsetWidth;
      this.chartWidth.set(width);
    }
  }

  getCellColor(rsValue: number | null): string {
    return AlignmentCalculator.getRsColor(rsValue, this.colorScheme());
  }

  getCellTooltip(cell: HeatmapCellPosition): string {
    return `${cell.interval}: ${cell.rsValue?.toFixed(2) ?? 'N/A'}\n${cell.dateStart} to ${cell.dateEnd}`;
  }

  trackByInterval(index: number, item: any): string {
    return item.interval;
  }

  trackByCell(index: number, cell: HeatmapCellPosition): string {
    return `${cell.dateStart}-${cell.dateEnd}`;
  }
}
```

Create `heatmap-chart-heatmap.component.html`:

```html
<div #heatmapContainer class="heatmap-container">
  @for (rowData of alignmentData(); track trackByInterval($index, rowData)) {
    <div class="heatmap-row">
      <div class="row-label">{{ rowData.interval.charAt(0) }}</div>
      <div class="cells-container">
        @for (cell of rowData.alignment.heatmapCells; track trackByCell($index, cell)) {
          <div
            class="heatmap-cell"
            [style.left.px]="cell.x"
            [style.width.px]="cell.width"
            [style.background-color]="getCellColor(cell.rsValue)"
            [matTooltip]="getCellTooltip(cell)"
          ></div>
        }
      </div>
    </div>
  }
</div>
```

Create `heatmap-chart-heatmap.component.scss`:

```scss
@use '@styles/mixins' as *;

.heatmap-container {
  width: 100%;
  background: var(--surface-color);
  border-radius: rem(8);
  padding: rem(16);
  display: flex;
  flex-direction: column;
  gap: rem(4);
}

.heatmap-row {
  display: flex;
  align-items: center;
  gap: rem(8);
  height: rem(32);
}

.row-label {
  width: rem(24);
  font-size: rem(12);
  font-weight: 600;
  text-align: center;
  flex-shrink: 0;
}

.cells-container {
  position: relative;
  flex: 1;
  height: 100%;
}

.heatmap-cell {
  position: absolute;
  top: 0;
  height: 100%;
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
  }
}
```

## 4. Integration with Main Heatmap

### Step 4.3: Add Navigation from Main Heatmap

Modify the main heatmap component to add a click handler for rows:

```typescript
// In main heatmap component
onRowClick(baseline: string, symbol: string): void {
  // TODO: Pass list context for navigation support
  const listContext = {
    listId: this.currentListId,
    pairIds: this.currentPairIds,
    currentIndex: this.currentPairIds.indexOf(`${baseline}_${symbol}`)
  };
  
  this.router.navigate(['/heatmap-chart', baseline, symbol], {
    state: { listContext }
  });
}
```

Update the heatmap template to make rows clickable:

```html
<!-- In main heatmap row template -->
<tr 
  class="heatmap-row clickable"
  (click)="onRowClick(row.baseline, row.symbol)"
  [attr.data-testid]="'heatmap-row-' + row.symbol"
>
  <!-- existing row content -->
</tr>
```

## 5. Testing Implementation

### Step 5.1: Unit Tests for Alignment Calculator

Create `alignment-calculator.spec.ts`:

```typescript
import { AlignmentCalculator } from './alignment-calculator';
import { OhlcvBar, RsDataPoint } from '../models/rs-correlation.types';

describe('AlignmentCalculator', () => {
  const mockChartBars: OhlcvBar[] = [
    { date: '2026-01-06', open: 100, high: 105, low: 99, close: 103, volume: 1000 },
    { date: '2026-01-07', open: 103, high: 106, low: 102, close: 105, volume: 1100 },
    { date: '2026-01-08', open: 105, high: 108, low: 104, close: 107, volume: 1200 },
    { date: '2026-01-09', open: 107, high: 110, low: 106, close: 109, volume: 1300 },
    { date: '2026-01-10', open: 109, high: 111, low: 108, close: 110, volume: 1400 }
  ];

  describe('calculateAlignment', () => {
    it('should calculate correct bar positions for daily data', () => {
      const rsData: RsDataPoint[] = [
        { date: '2026-01-06', rsRaw: 55 },
        { date: '2026-01-07', rsRaw: 60 },
        { date: '2026-01-08', rsRaw: 65 }
      ];

      const result = AlignmentCalculator.calculateAlignment(
        mockChartBars,
        rsData,
        'DAILY',
        1000
      );

      expect(result.barWidth).toBe(200); // 1000 / 5
      expect(result.bars.length).toBe(5);
      expect(result.bars[0].x).toBe(0);
      expect(result.bars[1].x).toBe(200);
    });

    it('should calculate correct cell spanning for weekly data', () => {
      const rsData: RsDataPoint[] = [
        { date: '2026-01-05', rsRaw: 65 } // Week start (Monday)
      ];

      const result = AlignmentCalculator.calculateAlignment(
        mockChartBars,
        rsData,
        'WEEKLY',
        1000
      );

      expect(result.heatmapCells.length).toBe(1);
      expect(result.heatmapCells[0].barIndices.length).toBe(5); // All 5 days in the week
      expect(result.heatmapCells[0].width).toBe(1000); // Spans full width
    });
  });

  describe('getRsColor', () => {
    it('should return correct colors for RS values', () => {
      expect(AlignmentCalculator.getRsColor(75)).toContain('green');
      expect(AlignmentCalculator.getRsColor(25)).toContain('red');
      expect(AlignmentCalculator.getRsColor(null)).toContain('neutral');
    });
  });
});
```

### Step 5.2: Component Tests

Create tests for each component following Jest patterns.

### Step 5.3: E2E Tests

Create `cypress/e2e/rs-correlation.cy.ts`:

```typescript
describe('RS Heatmap Chart View', () => {
  beforeEach(() => {
    cy.login(); // Assume auth helper exists
    cy.visit('/dashboard');
  });

  it('should navigate to heatmap chart view when clicking heatmap row', () => {
    cy.get('[data-testid="heatmap-row-AAPL"]').click();
    cy.url().should('include', '/heatmap-chart/SPY/AAPL');
  });

  it('should display chart and heatmap sections', () => {
    cy.visit('/heatmap-chart-view/SPY/AAPL');
    cy.get('.chart-container').should('be.visible');
    cy.get('.heatmap-container').should('be.visible');
  });

  it('should switch timeframes correctly', () => {
    cy.visit('/heatmap-chart-view/SPY/AAPL');
    
    // Default is Daily
    cy.get('.heatmap-row').should('have.length', 3); // D, W, M all visible
    
    // Switch to Weekly
    cy.contains('mat-button-toggle', 'W').click();
    cy.get('.heatmap-row').should('have.length', 2); // W, M visible
    
    // Switch to Monthly
    cy.contains('mat-button-toggle', 'M').click();
    cy.get('.heatmap-row').should('have.length', 1); // M only
  });

  it('should show tooltips on heatmap cell hover', () => {
    cy.visit('/heatmap-chart/SPY/AAPL');
    cy.get('.heatmap-cell').first().trigger('mouseenter');
    cy.get('.mat-tooltip').should('be.visible');
  });
});
```

## 6. Styling and Theme Integration

### Step 6.1: Add Theme Variables

Add to `src/styles/_variables.scss`:

```scss
// RS Correlation View Colors
$rs-strong-green: #00c853;
$rs-green: #4caf50;
$rs-light-green: #8bc34a;
$rs-light-red: #ff9800;
$rs-red: #f44336;
$rs-strong-red: #d32f2f;
$rs-neutral: #9e9e9e;
```

### Step 6.2: Add to Theme

Update theme files to include correlation view variables.

## 7. Performance Optimizations

### Step 7.1: Implement Virtual Scrolling (if needed)

If the number of bars exceeds 500, implement virtual scrolling using Angular CDK.

### Step 7.2: Debounce Resize Events

Add debouncing to window resize handler:

```typescript
private resizeSubject = new Subject<void>();

ngAfterViewInit(): void {
  this.resizeSubject
    .pipe(debounceTime(200))
    .subscribe(() => this.updateChartWidth());
    
  window.addEventListener('resize', () => this.resizeSubject.next());
}
```

## 8. Documentation Updates

### Step 8.1: Update User Flow Doc

Add new user flow to `docs/planning/12_USER_FLOW.md`:

```markdown
* **User Views RS Correlation**: Describes how a user analyzes RS-price correlation.
  1. User is viewing the main heatmap.
  2. User clicks on a pair row to open the correlation view.
  3. The correlation view loads with chart and aligned heatmap cells.
  4. User can switch between D/W/M timeframes.
  5. User hovers over heatmap cells to see RS values and date ranges.
  6. User zooms/pans the chart to analyze specific periods.
```

### Step 8.2: Update Frontend Doc

Add section to `docs/planning/2_FRONTEND.md` referencing the new view.

### Step 8.3: Integrate Dashboard-v3 Color Scheme

Import and integrate the dynamic color scheme system from dashboard-v3:

```typescript
// TODO: Import dashboard-v3 color utilities
// import { HeatmapColorService } from '@features/dashboard-v3/services/heatmap-color.service';

// In HeatmapChartHeatmapComponent:
const colorService = inject(HeatmapColorService);

getCellColor(rsValue: number | null): string {
  return colorService.getColor(rsValue, this.colorScheme());
}
```

## 9. Deployment Checklist

- [ ] All TypeScript types defined
- [ ] Data service implemented and tested
- [ ] Signal store implemented and tested
- [ ] All components created with templates and styles
- [ ] Alignment calculator utility tested
- [ ] Route configured
- [ ] Navigation from main heatmap added
- [ ] Unit tests passing (>80% coverage)
- [ ] E2E tests passing
- [ ] Theme variables added
- [ ] Documentation updated
- [ ] Code review completed
- [ ] Feature flag enabled (if applicable)

## 10. Future Enhancements (Post-MVP)

### Phase 5: Advanced Features

1. **Correlation Metrics**: Calculate and display Pearson correlation coefficient
2. **Signal Overlays**: Show buy/sell signals on chart and highlight corresponding cells
3. **Export Functionality**: Export chart + heatmap as PNG/SVG
4. **Date Range Picker**: Allow custom date range selection
5. **Multi-Pair Grid**: Compare multiple pairs side-by-side
6. **Performance Metrics**: Show win rate, avg gain/loss when signals align with RS thresholds

## 11. Known Limitations

1. **MVP Scope**: Phase 1 only supports Daily chart with Daily heatmap (1:1 alignment)
2. **Weekly/Monthly Aggregation**: OHLCV aggregation for W/M timeframes deferred to Phase 2
3. **Mobile Support**: Desktop-only for MVP; mobile support unlikely to be added
4. **Max Date Range**: No limit - supports entire available dataset
5. **Real-time Updates**: No live streaming of RS updates in heatmap chart view for MVP
6. **Signal Overlays**: Deferred until new signal generation system is built

## 12. Success Metrics

- Users can successfully navigate from heatmap to correlation view
- Chart and heatmap cells are visually aligned (verified via E2E tests)
- Timeframe switching works without errors
- Page load time < 2 seconds for 6 months of data
- Zero console errors in production
- User feedback indicates the view helps identify entry points
