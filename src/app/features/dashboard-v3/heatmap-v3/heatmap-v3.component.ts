import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, computed, signal, viewChild } from '@angular/core';
import { NgStyle, DecimalPipe } from '@angular/common';
import { CdkVirtualScrollViewport, CdkFixedSizeVirtualScroll, CdkVirtualForOf } from '@angular/cdk/scrolling';
import { BaselineTargetRankDatum, Timeframe } from '../../shared/types/rs.interfaces';
import { RelStrBaseComponent } from '../../rel-str-base/rel-str-base.component';
import { RsDataStore } from '../../store/rs-data.store';
import { MONTHS, DAYS } from '../../shared/utils/date.util';
import { AppRoutes } from '../../../core/common/interfaces';
import { DashboardV3Store } from '../store/dashboard-v3.store';
import { calculateEmaSeriesForValues } from '../../shared/utils/ma.util';

type SelectionType = 'chart' | 'history';

const HEADER_CELL_CORNER_TEXT = 'Symbol/Date';

@Component({
    selector: 'rs-heatmap-v3',
    standalone: true,
    imports: [DecimalPipe, CdkVirtualScrollViewport, CdkFixedSizeVirtualScroll, CdkVirtualForOf],
    templateUrl: './heatmap-v3.component.html',
    styleUrl: './heatmap-v3.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapV3Component extends RelStrBaseComponent {
    dataScroller = viewChild<ElementRef<HTMLDivElement>>('dataScroller' as any);
    firstColumnViewport = viewChild<CdkVirtualScrollViewport>('firstColumnViewport' as any);
    dataRowsViewport = viewChild<CdkVirtualScrollViewport>('dataRowsViewport' as any);
    buttonsViewport = viewChild<CdkVirtualScrollViewport>('buttonsViewport' as any);

    headerCells = signal<string[]>([]);
    ranksDataWithColorsEntries = signal<[string, BaselineTargetRankDatum[]][]>([]);
    sortDateIndex = signal<number | null>(null);
    sortDirection = signal<'asc' | 'desc'>('desc');
    sortedRanksDataWithColorsEntries = computed<[string, BaselineTargetRankDatum[]][]>(() => {
        const entries = this.ranksDataWithColorsEntries();
        const sortIndex = this.sortDateIndex();
        const direction = this.sortDirection();
        const rsmaWindow = this.dashboardV3Store.rsmaWindow();

        if (sortIndex === null || sortIndex < 0) {
            return entries;
        }

        const rsmaCache = new Map<string, { missing: boolean; value: number }>();

        const getSortMeta = (row: [string, BaselineTargetRankDatum[]]) => {
            const [pairId, cells] = row;
            const key = `${pairId}:${sortIndex}:${rsmaWindow}`;
            const cached = rsmaCache.get(key);
            if (cached) {
                return cached;
            }

            const series: Array<number | null> = cells.map((cell) => {
                if (!cell || cell.placeholder === true) {
                    return null;
                }
                const v = Number(cell.value ?? 0);
                return Number.isFinite(v) ? v : null;
            });

            const ema = calculateEmaSeriesForValues(series, rsmaWindow);
            const score = ema[sortIndex];

            if (score == null || !Number.isFinite(score)) {
                const meta = { missing: true, value: 0 };
                rsmaCache.set(key, meta);
                return meta;
            }

            const meta = { missing: false, value: score };
            rsmaCache.set(key, meta);
            return meta;
        };

        const sorted = [...entries].sort((a, b) => {
            const av = getSortMeta(a);
            const bv = getSortMeta(b);

            if (av.missing && bv.missing) return 0;
            if (av.missing) return 1;
            if (bv.missing) return -1;

            const diff = av.value - bv.value;
            return direction === 'asc' ? diff : -diff;
        });

        return sorted;
    });
    monthGroups = signal<Array<{ label: string; span: number; alt: boolean }>>([]);

    private readonly rsDataStore = inject(RsDataStore);
    private readonly dashboardV3Store = inject(DashboardV3Store);

    selectedTimeframe = computed(() => this.rsDataStore.selectedTimeframe());

    renderedTimeframe = computed<Timeframe>(() => {
        return this.selectedTimeframe() as Timeframe;
    });

    headerDateParts = computed(() => {
        const headers = this.headerCells();
        const dates = headers.length > 1 ? headers.slice(1) : [];
        const timeframe = this.renderedTimeframe();
        return dates.map(d => ({
            raw: d,
            date: this.formatHeaderDate(d, timeframe),
            dow: this.formatHeaderDow(d, timeframe),
            weekAlt: this.isAltWeek(d),
            weekStart: this.isWeekStart(d),
        }));
    });
    weekStartMap = computed<Record<string, boolean>>(() => {
        const map: Record<string, boolean> = {};
        for (const h of this.headerDateParts()) map[h.raw] = h.weekStart;
        return map;
    });
    sortedDateKey = computed<string | null>(() => {
        const parts = this.headerDateParts();
        const idx = this.sortDateIndex();
        if (idx === null || idx < 0 || idx >= parts.length) {
            return null;
        }
        return parts[idx]?.raw ?? null;
    });

    constructor() {
        super();

        effect(() => {
            const _entries = this.ranksDataWithColorsEntries();
            this.scrollToRight();
        });

        effect(() => {
            const headers = this.headerCells();
            const dateStrs = headers.slice(1);
            const timeframe = this.renderedTimeframe();
            this.monthGroups.set(this.computeMonthGroups(dateStrs, timeframe));
        });

        effect(() => {
            const ranks = this.dashboardV3Store.heatmapRanksData();
            if (!ranks || Object.keys(ranks).length === 0) {
                this.ranksDataWithColorsEntries.set([]);
                this.headerCells.set([HEADER_CELL_CORNER_TEXT]);
                this.monthGroups.set([]);
                this.sortDateIndex.set(null);
                return;
            }
            const entries = Object.entries(ranks) as [string, BaselineTargetRankDatum[]][];
            this.ranksDataWithColorsEntries.set(entries);

            const first = entries[0]?.[1];
            if (!Array.isArray(first) || first.length === 0) {
                this.headerCells.set([HEADER_CELL_CORNER_TEXT]);
                this.monthGroups.set([]);
                this.sortDateIndex.set(null);
                return;
            }

            const dates: string[] = [HEADER_CELL_CORNER_TEXT];
            for (const datum of first) {
                dates.push(datum.date);
            }
            this.headerCells.set(dates);

            // Default sort: latest date column, descending (highest RS first)
            const lastIndex = first.length - 1;
            if (lastIndex >= 0) {
                this.sortDateIndex.set(lastIndex);
                this.sortDirection.set('desc');
            } else {
                this.sortDateIndex.set(null);
            }
        });
    }

    handleCellSelection() {
    }

    handleSymbolSelection(symbol: string, selectionType: SelectionType) {
        const route = selectionType === 'chart' ? AppRoutes.SYNC_CHART : AppRoutes.HISTORY;
        this.router.navigate([route]);
    }

    onHeaderDateClick(rawDate: string): void {
        const parts = this.headerDateParts();
        const idx = parts.findIndex(p => p.raw === rawDate);
        if (idx < 0) {
            return;
        }

        const currentIndex = this.sortDateIndex();
        const currentDirection = this.sortDirection();

        if (currentIndex === idx) {
            this.sortDirection.set(currentDirection === 'asc' ? 'desc' : 'asc');
        } else {
            this.sortDateIndex.set(idx);
            this.sortDirection.set('desc');
        }
    }

    isHeaderSorted(rawDate: string): boolean {
        const parts = this.headerDateParts();
        const idx = this.sortDateIndex();
        if (idx === null || idx < 0 || idx >= parts.length) {
            return false;
        }
        return parts[idx]?.raw === rawDate;
    }

    private scrollToRight(): void {
        setTimeout(() => {
            const el = this.dataScroller()?.nativeElement;
            if (!el) {
                // eslint-disable-next-line no-console
                console.warn('[HeatmapV3] scrollToRight: dataScroller element not found');
                return;
            }
            // eslint-disable-next-line no-console
            console.log('[HeatmapV3] scrollToRight:', {
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                scrollLeft_before: el.scrollLeft,
            });
            el.scrollLeft = el.scrollWidth;
            // eslint-disable-next-line no-console
            console.log('[HeatmapV3] scrollToRight after:', { scrollLeft: el.scrollLeft });
            
            // Retry after layout settles if scroll didn't happen
            setTimeout(() => {
                if (el.scrollLeft === 0 && el.scrollWidth > el.clientWidth) {
                    // eslint-disable-next-line no-console
                    console.log('[HeatmapV3] scrollToRight retry:', { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
                    el.scrollLeft = el.scrollWidth;
                }
            }, 200);
        }, 300);
    }

    private formatHeaderDate(dateStr: string, timeframe: Timeframe): string {
        const d = this.parseISODate(dateStr);

        switch (timeframe) {
            case Timeframe.MONTHLY:
                return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
            case Timeframe.WEEKLY:
            case Timeframe.DAILY:
            default:
                const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                const dd = String(d.getUTCDate()).padStart(2, '0');
                return `${mm}-${dd}`;
        }
    }

    private formatHeaderDow(dateStr: string, timeframe: Timeframe): string {
        const d = this.parseISODate(dateStr);

        switch (timeframe) {
            case Timeframe.MONTHLY:
                return 'M';
            case Timeframe.WEEKLY: {
                const week = this.getISOWeek(d);
                return `W${week}`;
            }
            case Timeframe.DAILY:
            default:
                return DAYS[d.getUTCDay()];
        }
    }

    private isAltWeek(dateStr: string): boolean {
        const d = this.parseISODate(dateStr);
        const week = this.getISOWeek(d);
        return week % 2 === 1;
    }

    private isWeekStart(dateStr: string): boolean {
        const d = this.parseISODate(dateStr);
        return d.getUTCDay() === 1;
    }

    private parseISODate(dateStr: string): Date {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
    }

    private getISOWeek(d: Date): number {
        const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const dayNum = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        const diffDays = Math.floor((date.getTime() - yearStart.getTime()) / 86400000) + 1;
        return Math.ceil(diffDays / 7);
    }

    private computeMonthGroups(dateStrs: string[], timeframe: Timeframe): Array<{ label: string; span: number; alt: boolean }> {
        if (!dateStrs.length) return [];
        const groups: Array<{ label: string; span: number; alt: boolean }> = [];

        if (timeframe === Timeframe.MONTHLY) {
            let currentLabel = this.yearLabel(this.parseISODate(dateStrs[0]));
            let span = 0;
            for (const ds of dateStrs) {
                const d = this.parseISODate(ds);
                const lbl = this.yearLabel(d);
                if (lbl !== currentLabel) {
                    groups.push({ label: currentLabel, span, alt: groups.length % 2 === 1 });
                    currentLabel = lbl;
                    span = 1;
                } else {
                    span += 1;
                }
            }
            groups.push({ label: currentLabel, span, alt: groups.length % 2 === 1 });
        } else {
            let currentLabel = this.monthLabel(this.parseISODate(dateStrs[0]));
            let span = 0;
            for (const ds of dateStrs) {
                const d = this.parseISODate(ds);
                const lbl = this.monthLabel(d);
                if (lbl !== currentLabel) {
                    groups.push({ label: currentLabel, span, alt: groups.length % 2 === 1 });
                    currentLabel = lbl;
                    span = 1;
                } else {
                    span += 1;
                }
            }
            groups.push({ label: currentLabel, span, alt: groups.length % 2 === 1 });
        }

        return groups;
    }

    private yearLabel(d: Date): string {
        return d.getUTCFullYear().toString();
    }

    private monthLabel(d: Date): string {
        return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }

    onDataRowsScroll(): void {
        const dataViewport = this.dataRowsViewport();
        const firstColViewport = this.firstColumnViewport();
        const buttonsViewport = this.buttonsViewport();

        if (!dataViewport || !firstColViewport || !buttonsViewport) {
            return;
        }

        const scrollOffset = dataViewport.measureScrollOffset();
        firstColViewport.scrollToOffset(scrollOffset);
        buttonsViewport.scrollToOffset(scrollOffset);
    }
}
