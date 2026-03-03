import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, computed, signal, viewChild, AfterViewInit, OnDestroy } from '@angular/core';
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

/**
 * Debug toggle for heatmap row expansion.
 *
 * When `true`, the v3 heatmap will deliberately **triple** the effective
 * row count by repeating the full symbol list three times. This is used to
 * stress‑test vertical scrolling and rendering performance without requiring
 * a larger backend universe.
 *
 * When `false`, the heatmap renders exactly one row per pair as provided by
 * `DashboardV3Store.heatmapRanksData`.
 *
 * Flip this flag locally during development instead of commenting blocks of
 * code in and out. This keeps the production behavior explicit while
 * preserving the shim logic for future diagnostics.
 */
const DEBUG_TRIPLE_ROWS = false;

@Component({
    selector: 'rs-heatmap-v4',
    standalone: true,
    imports: [DecimalPipe, CdkVirtualScrollViewport, CdkFixedSizeVirtualScroll, CdkVirtualForOf],
    templateUrl: './heatmap-v4.component.html',
    styleUrl: './heatmap-v4.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapV4Component extends RelStrBaseComponent implements AfterViewInit, OnDestroy {
    headerContainer = viewChild<ElementRef<HTMLDivElement>>('headerContainer');
    bodyViewport = viewChild<CdkVirtualScrollViewport>('bodyViewport');
    private readonly hostEl = inject(ElementRef<HTMLElement>);
    private ro?: ResizeObserver;
    private readonly boundResize = () => this.updateVertScrollbarWidth();

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
    monthGroups = signal<Array<{ label: string; span: number; alt: boolean; yearStart: boolean }>>([]);

    private readonly rsDataStore = inject(RsDataStore);
    private readonly dashboardV3Store = inject(DashboardV3Store);

    // Prevent recursive scroll syncing between header and body
    private isSyncingScroll = false;
    // Ensure we only auto-scroll once per dataset load
    private didAutoScrollForLoad = false;

    selectedTimeframe = computed(() => this.rsDataStore.selectedTimeframe());

    renderedTimeframe = computed<Timeframe>(() => {
        return this.selectedTimeframe() as Timeframe;
    });

    renderedTimeframeStr = computed<string>(() => {
        const tf = this.renderedTimeframe();
        switch (tf) {
            case Timeframe.DAILY: return 'DAILY';
            case Timeframe.WEEKLY: return 'WEEKLY';
            case Timeframe.MONTHLY: return 'MONTHLY';
            default: return 'DAILY';
        }
    });

    readonly CELL_WIDTH_PX = 60; // must match --heatmap-cell-width

    headerDateParts = computed(() => {
        const headers = this.headerCells();
        const dates = headers.length > 1 ? headers.slice(1) : [];
        const timeframe = this.renderedTimeframe();
        return dates.map((d, idx) => {
            const prev = idx > 0 ? dates[idx - 1] : null;
            return {
                raw: d,
                date: this.formatHeaderDate(d, timeframe),
                dow: this.formatHeaderDow(d, timeframe),
                weekAlt: this.isAltWeek(d),
                weekStart: timeframe === Timeframe.DAILY ? this.isWeekStart(d) : false,
                monthStart: timeframe === Timeframe.WEEKLY ? this.isMonthStart(d, prev) : false,
                yearStart: timeframe === Timeframe.MONTHLY ? this.isYearStart(d, prev) : false,
            } as {
                raw: string; date: string; dow: string; weekAlt: boolean; weekStart: boolean; monthStart?: boolean; yearStart?: boolean;
            };
        });
    });

    // Total pixel width of the scrollable data area (forces horizontal overflow when needed)
    headerPixelWidth = computed(() => this.headerDateParts().length * this.CELL_WIDTH_PX);
    weekStartMap = computed<Record<string, boolean>>(() => {
        const map: Record<string, boolean> = {};
        for (const h of this.headerDateParts()) map[h.raw] = h.weekStart;
        return map;
    });
    monthStartMap = computed<Record<string, boolean>>(() => {
        const map: Record<string, boolean> = {};
        for (const h of this.headerDateParts()) map[h.raw] = (h as any).monthStart === true;
        return map;
    });
    yearStartMap = computed<Record<string, boolean>>(() => {
        const map: Record<string, boolean> = {};
        for (const h of this.headerDateParts()) map[h.raw] = (h as any).yearStart === true;
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
            const headers = this.headerCells();
            const dateStrs = headers.slice(1);
            const timeframe = this.renderedTimeframe();
            this.monthGroups.set(this.computeMonthGroups(dateStrs, timeframe));
            // When headers change (new dataset), schedule an auto-scroll to the rightmost edge
            // so the latest dates are visible by default.
            if (dateStrs.length > 0) {
                this.scheduleAutoScrollToEnd();
            }
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

            /**
             * Optional development shim: triple the effective row count.
             *
             * When `DEBUG_TRIPLE_ROWS` is enabled, we construct a new `expanded`
             * collection that repeats the **entire** symbol list three times,
             * with suffixed keys (`SYMBOL#1`, `SYMBOL#2`, `SYMBOL#3`). This keeps
             * rows visually grouped as `[list, list, list]` while significantly
             * increasing vertical scroll height for performance testing.
             *
             * In normal production runs (`DEBUG_TRIPLE_ROWS === false`), we
             * bypass this shim and render the canonical `entries` one‑for‑one so
             * that each pair appears exactly once in the heatmap.
             */
            if (DEBUG_TRIPLE_ROWS) {
                const expanded: [string, BaselineTargetRankDatum[]][] = [];
                const multiply = 3;
                for (let i = 0; i < multiply; i += 1) {
                    for (const [key, value] of entries) {
                        expanded.push([`${key}#${i + 1}`, value]);
                    }
                }
                this.ranksDataWithColorsEntries.set(expanded);
                // When expanding, keep natural insertion order instead of
                // initializing a default sort column. This preserves the visual
                // grouping of the three repeated lists.
                this.sortDateIndex.set(null);
            } else {
                // Standard behavior: use the canonical ranks as provided by the
                // store, one row per pair with no artificial replication.
                this.ranksDataWithColorsEntries.set(entries);
            }

            const first = entries[0]?.[1];
            if (!Array.isArray(first) || first.length === 0) {
                this.headerCells.set([HEADER_CELL_CORNER_TEXT]);
                this.monthGroups.set([]);
                this.sortDateIndex.set(null);
                this.didAutoScrollForLoad = false;
                return;
            }

            const dates: string[] = [HEADER_CELL_CORNER_TEXT];
            for (const datum of first) {
                dates.push(datum.date);
            }
            this.headerCells.set(dates);
            this.didAutoScrollForLoad = false; // allow auto-scroll for this new load

            // Default sort (non-debug): latest date column, descending (highest RS first).
            // When DEBUG_TRIPLE_ROWS is enabled, we intentionally skip sort
            // initialization above to preserve insertion order for the expanded
            // lists; here we only apply default sorting when the canonical
            // one-row-per-pair path is active.
            if (!DEBUG_TRIPLE_ROWS) {
                const lastIndex = first.length - 1;
                if (lastIndex >= 0) {
                    this.sortDateIndex.set(lastIndex);
                    this.sortDirection.set('desc');
                } else {
                    this.sortDateIndex.set(null);
                }
            }
        });
    }

    ngAfterViewInit(): void {
        // Measure initial scrollbar width and observe for changes
        this.observeViewportScrollbar();
    }

    ngOnDestroy(): void {
        this.ro?.disconnect();
        window.removeEventListener('resize', this.boundResize);
    }

    private observeViewportScrollbar(): void {
        this.updateVertScrollbarWidth();
        const viewport = this.bodyViewport();
        const el = viewport?.elementRef.nativeElement as HTMLElement | undefined;
        if (!el) return;
        try {
            this.ro = new ResizeObserver(() => this.updateVertScrollbarWidth());
            this.ro.observe(el);
        } catch {
            // no-op if ResizeObserver not available
        }
        window.addEventListener('resize', this.boundResize, { passive: true });
    }

    private updateVertScrollbarWidth(): void {
        const viewport = this.bodyViewport();
        const el = viewport?.elementRef.nativeElement as HTMLElement | undefined;
        if (!el) return;
        // Vertical scrollbar width is the horizontal space taken from the client area
        const scrollbar = Math.max(0, el.offsetWidth - el.clientWidth);
        this.hostEl.nativeElement.style.setProperty('--heatmap-vert-scrollbar', `${scrollbar}px`);
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

    private isMonthStart(currStr: string, prevStr: string | null): boolean {
        if (!prevStr) return true;
        const c = this.parseISODate(currStr);
        const p = this.parseISODate(prevStr);
        return c.getUTCMonth() !== p.getUTCMonth() || c.getUTCFullYear() !== p.getUTCFullYear();
    }

    private isYearStart(currStr: string, prevStr: string | null): boolean {
        if (!prevStr) return true;
        const c = this.parseISODate(currStr);
        const p = this.parseISODate(prevStr);
        return c.getUTCFullYear() !== p.getUTCFullYear();
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

    private computeMonthGroups(dateStrs: string[], timeframe: Timeframe): Array<{ label: string; span: number; alt: boolean; yearStart: boolean }> {
        if (!dateStrs.length) return [];
        const groups: Array<{ label: string; span: number; alt: boolean; yearStart: boolean }> = [];

        if (timeframe === Timeframe.MONTHLY) {
            let currentLabel = this.yearLabel(this.parseISODate(dateStrs[0]));
            let span = 0;
            for (const ds of dateStrs) {
                const d = this.parseISODate(ds);
                const lbl = this.yearLabel(d);
                if (lbl !== currentLabel) {
                    groups.push({ label: currentLabel, span, alt: groups.length % 2 === 1, yearStart: false });
                    currentLabel = lbl;
                    span = 1;
                } else {
                    span += 1;
                }
            }
            groups.push({ label: currentLabel, span, alt: groups.length % 2 === 1, yearStart: true });
        } else {
            let currentLabel = this.monthLabel(this.parseISODate(dateStrs[0]));
            let span = 0;
            let currentYear = this.parseISODate(dateStrs[0]).getUTCFullYear();
            for (const ds of dateStrs) {
                const d = this.parseISODate(ds);
                const lbl = this.monthLabel(d);
                if (lbl !== currentLabel) {
                    const isYearStart = d.getUTCMonth() === 0 && d.getUTCFullYear() !== currentYear;
                    groups.push({ label: currentLabel, span, alt: groups.length % 2 === 1, yearStart: isYearStart });
                    currentLabel = lbl;
                    span = 1;
                    currentYear = d.getUTCFullYear();
                } else {
                    span += 1;
                }
            }
            // Determine if the final pushed month starts a new year relative to previous
            groups.push({ label: currentLabel, span, alt: groups.length % 2 === 1, yearStart: this.parseISODate(dateStrs[0]).getUTCMonth() === 0 });
        }

        return groups;
    }

    private yearLabel(d: Date): string {
        return d.getUTCFullYear().toString();
    }

    private monthLabel(d: Date): string {
        return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }

    onBodyScroll(event: Event): void {
        if (this.isSyncingScroll) return;
        const target = event.target as HTMLElement;
        const headerEl = this.headerContainer()?.nativeElement;
        if (!headerEl) return;
        this.isSyncingScroll = true;
        headerEl.scrollLeft = target.scrollLeft;
        // Align overlay grids by setting a shared CSS var on the host
        const phase = -(target.scrollLeft % this.CELL_WIDTH_PX);
        this.hostEl.nativeElement.style.setProperty('--heatmap-grid-offset', `${phase}px`);
        // Release flag on next frame to coalesce multiple events
        requestAnimationFrame(() => {
            this.isSyncingScroll = false;
        });
    }

    onHeaderScroll(event: Event): void {
        if (this.isSyncingScroll) return;
        const target = event.target as HTMLElement;
        const viewport = this.bodyViewport();
        const bodyEl = viewport?.elementRef.nativeElement as HTMLElement | undefined;
        if (!bodyEl) return;
        this.isSyncingScroll = true;
        bodyEl.scrollLeft = target.scrollLeft;
        // Keep phase in sync when header is the scroller
        const phase = -(target.scrollLeft % this.CELL_WIDTH_PX);
        this.hostEl.nativeElement.style.setProperty('--heatmap-grid-offset', `${phase}px`);
        requestAnimationFrame(() => {
            this.isSyncingScroll = false;
        });
    }

    private scheduleAutoScrollToEnd(): void {
        if (this.didAutoScrollForLoad) return;
        // Wait for the virtual scroll content to render and size.
        // First, ensure we measure and apply the body's vertical scrollbar width so
        // header/month-band spacers are correct before initial alignment.
        requestAnimationFrame(() => {
            this.updateVertScrollbarWidth();
            // Allow one more frame for the CSS variable to apply and affect layout
            requestAnimationFrame(() => {
                const viewport = this.bodyViewport();
                const bodyEl = viewport?.elementRef.nativeElement as HTMLElement | undefined;
                const headerEl = this.headerContainer()?.nativeElement as HTMLElement | undefined;
                if (!bodyEl) return;
                const maxScroll = bodyEl.scrollWidth - bodyEl.clientWidth;
                if (maxScroll > 0) {
                    this.isSyncingScroll = true;
                    // Use scrollTo with full scrollWidth to avoid fractional rounding issues
                    bodyEl.scrollTo({ left: bodyEl.scrollWidth, behavior: 'auto' });
                    // Force layout read to ensure header width reflects spacer var before syncing
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    headerEl && headerEl.offsetWidth;
                    if (headerEl) {
                        headerEl.scrollLeft = bodyEl.scrollLeft;
                    }
                    const phase = -(bodyEl.scrollLeft % this.CELL_WIDTH_PX);
                    this.hostEl.nativeElement.style.setProperty('--heatmap-grid-offset', `${phase}px`);
                    requestAnimationFrame(() => {
                        this.isSyncingScroll = false;
                    });
                    this.didAutoScrollForLoad = true;
                }
            });
        });
    }
}
