import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, signal } from '@angular/core';
import { DecimalPipe, NgStyle } from '@angular/common';

import { BaselineTargetRankDatum, StockData } from '../../shared/types/rs.interfaces';
import { RelStrBaseComponent } from '../../rel-str-base/rel-str-base.component';
import { AppRoutes } from '../../../core/common/interfaces';

type SelectionType = 'chart' | 'history';

const HEADER_CELL_CORNER_TEXT = 'Symbol/Date';

@Component({
    selector: 'rs-heatmap-v2',
    imports: [NgStyle, DecimalPipe],
    templateUrl: './heatmap.component.html',
    styleUrl: './heatmap.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeatmapComponent extends RelStrBaseComponent implements AfterViewInit {
    
    headerCells = signal<string[]>([]);
    ranksDataWithColorsEntries = signal<[string, BaselineTargetRankDatum[]][]>([]);
    monthGroups = signal<Array<{ label: string; span: number; alt: boolean }>>([]);
    headerDateParts = computed(() => {
        const headers = this.headerCells();
        const dates = headers.length > 1 ? headers.slice(1) : [];
        return dates.map(d => ({
            raw: d,
            date: this.formatHeaderDate(d),
            dow: this.formatHeaderDow(d),
            weekAlt: this.isAltWeek(d),
            weekStart: this.isWeekStart(d)
        }));
    });
    weekStartMap = computed<Record<string, boolean>>(() => {
        const map: Record<string, boolean> = {};
        for (const h of this.headerDateParts()) map[h.raw] = h.weekStart;
        return map;
    });
    @ViewChild('dataScroller', { static: false }) private dataScroller?: ElementRef<HTMLDivElement>;

    constructor() {
        super();
        // Auto-scroll when entries change (e.g., after data load)
        effect(() => {
            // create dependency on the entries signal
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const _entries = this.ranksDataWithColorsEntries();
            this.scrollToRight();
        });

        // Recompute month groups whenever header cells change
        effect(() => {
            const headers = this.headerCells();
            // First cell is the corner label; skip it
            const dateStrs = headers.slice(1);
            this.monthGroups.set(this.computeMonthGroups(dateStrs));
        });
    }

    ngOnInit() {
         this.selectedStockListV2$.pipe().subscribe(list => {
             // Guard: no list or no ranks data
             const ranks = list?.ranksDataWithColors;
             if (!ranks || Object.keys(ranks).length === 0) {
                 this.ranksDataWithColorsEntries.set([]);
                 this.headerCells.set([HEADER_CELL_CORNER_TEXT]);
                 this.monthGroups.set([]);
                 return;
             }

             const entries = Object.entries(ranks) as [string, BaselineTargetRankDatum[]][];
             this.ranksDataWithColorsEntries.set(entries);

             // Guard: no first entry
             const first = entries[0]?.[1];
             if (!Array.isArray(first) || first.length === 0) {
                 this.headerCells.set([HEADER_CELL_CORNER_TEXT]);
                 this.monthGroups.set([]);
                 return;
             }

             const dates: string[] = [HEADER_CELL_CORNER_TEXT];
             for (const datum of first) {
                 dates.push(datum.date);
             }
             this.headerCells.set(dates);
         });
	}

    ngAfterViewInit(): void {
        this.scrollToRight();
    }

    // Legacy demo generator removed; heatmap now relies on V2 store data only.

    handleCellSelection() {

    }

    handleSymbolSelection(symbol: string, selectionType: SelectionType) {
        // console.log('h hSS symbol/selection type: ', symbol, selectionType);
        const route = selectionType === 'chart' ? AppRoutes.SYNC_CHART : AppRoutes.HISTORY;
        this.router.navigate([route])
    }

    private scrollToRight(): void {
        // Defer to allow view to render before measuring scrollWidth
        setTimeout(() => {
            const el = this.dataScroller?.nativeElement;
            if (!el) return;
            el.scrollLeft = el.scrollWidth;
        }, 0);
    }

    /**
     * Format a header date string (ISO 'YYYY-MM-DD') as 'MM-DD'.
     * Year is intentionally omitted for compactness.
     */
    private formatHeaderDate(dateStr: string): string {
        const d = this.parseISODate(dateStr);
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        return `${mm}-${dd}`;
    }

    /**
     * Format day-of-week as a short label like 'Mon'.
     */
    private formatHeaderDow(dateStr: string): string {
        const d = this.parseISODate(dateStr);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return days[d.getUTCDay()];
    }

    /**
     * Return true for alternating weeks to allow header shading.
     * Uses ISO week number parity for stability across year boundaries.
     */
    private isAltWeek(dateStr: string): boolean {
        const d = this.parseISODate(dateStr);
        const week = this.getISOWeek(d);
        return week % 2 === 1; // alternate by odd/even week
    }

    /**
     * Mark the first day of the ISO week (Monday) so we can draw a stronger separator.
     */
    private isWeekStart(dateStr: string): boolean {
        const d = this.parseISODate(dateStr);
        // ISO week starts Monday => 1 when using getUTCDay with Sunday=0
        return d.getUTCDay() === 1;
    }

    // # Reason: Keep date parsing consistent (treat incoming 'YYYY-MM-DD' as UTC to avoid TZ drift)
    private parseISODate(dateStr: string): Date {
        // Assume 'YYYY-MM-DD' and parse as UTC to avoid timezone shifts
        const [y, m, d] = dateStr.split('-').map(Number);
        // Months are 0-indexed
        return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
    }

    // # Reason: ISO-8601 week allows consistent alternating shading across year boundaries
    private getISOWeek(d: Date): number {
        // Copy date (UTC) and set to nearest Thursday
        const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const dayNum = date.getUTCDay() || 7; // Sun=0 => 7
        date.setUTCDate(date.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        const diffDays = Math.floor((date.getTime() - yearStart.getTime()) / 86400000) + 1;
        return Math.ceil(diffDays / 7);
    }

    /**
     * Compute contiguous month groups from a list of ISO date strings.
     * Each group carries a label like 'Oct 2025', span (number of days), and alt flag for styling.
     */
    private computeMonthGroups(dateStrs: string[]): Array<{ label: string; span: number; alt: boolean }> {
        if (!dateStrs.length) return [];
        const groups: Array<{ label: string; span: number; alt: boolean }> = [];
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
        // push final group
        groups.push({ label: currentLabel, span, alt: groups.length % 2 === 1 });
        return groups;
    }

    /** Month label like 'Oct 2025' (UTC) */
    private monthLabel(d: Date): string {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
}
