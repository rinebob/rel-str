/**
 * Chart View Component
 *
 * Generic symbol-list chart viewer — a merged toolbar, a symbol pane, and
 * the shared D/W/M detail charts. Decoupled from ST signal runs: any list
 * source feeds the pane, Trade is always the manual-order path, and
 * untracked symbols chart fine (signal provenance isn't required).
 * URL: /trading/chart-view  (#1232/#1256)
 *
 * Several selection/triage methods are deliberate ports of chart-review's
 * (the name cache, willLeaveActiveList, advanceQueue, nav). One deliberate
 * divergence: chart-review let a selection dangle as a "detached chart"
 * when the last symbol left the viewport — the viewport-escape guard here
 * advances to the dropped symbol's neighbor or clears instead (#1258).
 * These are NOT extracted into a shared helper: chart-review is deleted
 * in #1260, so a shared abstraction would lose its second consumer
 * immediately. If #1260 slips and a third surface needs this logic,
 * extract then.
 */
import {
  Component,
  inject,
  effect,
  signal,
  computed,
  untracked,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  EnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AppRoutes } from '../../../../core/common/interfaces';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { ST_SYMBOLS_ROOT } from '@st/collections';
import { SymbolListStore } from '../../stores/symbol-list.store';
import { LatestRunStore } from '../../stores/latest-run.store';
import { OrderTicketStore } from '../../stores/order-ticket.store';
import { NO_MEMBERSHIP, type SymbolListFilter } from '../../common/constants';
import { TERMINAL_TICKET_STATUSES } from '../../services/order-ticket.types';
import { ChartViewViewportService } from '../../services/chart-view-viewport.service';
import { ChartToolbarStateService } from '../../services/chart-toolbar-state.service';
import { ManualOrderService } from '../../services/manual-order.service';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { ChartViewToolbarComponent } from '../../components/chart-view-toolbar/chart-view-toolbar.component';
import { SignalListComponent } from '../../components/signal-list/signal-list.component';
import { SignalDetailComponent } from '../../components/signal-detail/signal-detail.component';

@Component({
  selector: 'app-chart-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Page-scoped toolbar state — shared by the merged toolbar and the
  // detail charts; dies with the page (#1232/#1255).
  providers: [ChartToolbarStateService],
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    ChartViewToolbarComponent,
    SignalListComponent,
    SignalDetailComponent,
  ],
  templateUrl: './chart-view.component.html',
  styleUrl: './chart-view.component.scss',
})
export class ChartViewComponent implements OnInit, OnDestroy {
  readonly symbolListStore = inject(SymbolListStore);
  readonly latestRunStore = inject(LatestRunStore);
  private readonly ticketStore = inject(OrderTicketStore);
  readonly viewportService = inject(ChartViewViewportService);
  readonly uiStateService = inject(UiStateService);
  private readonly router = inject(Router);
  private readonly manualOrderService = inject(ManualOrderService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);

  /** Manual symbol input for quick chart viewing. */
  readonly manualSymbol = signal<string | null>(null);

  /** Currently selected symbol in the pane. */
  readonly selectedSymbol = signal<string | null>(null);

  /** Symbols already viewed this session — pane rows render dimmed.
   *  Session-local only; a page refresh resets it. */
  readonly viewedSymbols = signal<ReadonlySet<string>>(new Set<string>());

  /** Last-seen viewport — bookkeeping for the escape guard below, which
   *  needs the dropped symbol's prior index to advance to its neighbor.
   *  Read/written untracked: it mirrors viewportSymbols, never drives it. */
  private readonly prevViewport = signal<string[]>([]);

  /** Delegate viewport state from the viewport service. */
  readonly viewportSymbols = this.viewportService.viewportSymbols;
  readonly activeList = this.viewportService.activeList;
  readonly newOnly = this.viewportService.newOnly;

  /** The symbol the detail pane and toolbar act on. */
  readonly activeSymbol = computed(() => this.selectedSymbol() ?? this.manualSymbol());

  /** Index of the currently selected symbol within the viewport. */
  readonly selectedSymbolIndex = computed(() => {
    const symbol = this.selectedSymbol();
    if (!symbol) return -1;
    return this.viewportSymbols().indexOf(symbol);
  });

  /** Total number of symbols in the viewport. */
  readonly symbolCount = computed(() => this.viewportSymbols().length);

  /** Non-terminal tickets in the order queue — the Order pill count.
   *  Same derivation the review facade used; no run coupling. */
  readonly orderCount = computed(
    () =>
      Object.values(this.ticketStore.tickets()).filter(
        (t) => !TERMINAL_TICKET_STATUSES.has(t.status),
      ).length,
  );

  /** Whether the displayed symbol is in the tracked universe — gates the
   *  filing chips (untracked symbols have no list memberships). */
  readonly isTrackedSymbol = computed(() => {
    const symbol = this.activeSymbol();
    return !!symbol && this.symbolListStore.trackedSymbols().includes(symbol);
  });

  /** Pane symbols outside the tracked universe — the list renders them
   *  with a NEW chip so scan rows differentiate new vs tracked when the
   *  New-only filter is off. Empty on list sources (all tracked). */
  readonly untrackedPaneSymbols = computed(() => {
    const tracked = new Set(this.symbolListStore.trackedSymbols());
    return this.viewportSymbols().filter((s) => !tracked.has(s));
  });

  /** Cache of symbol -> company name fetched from Firestore. */
  private readonly symbolNameCache = signal<Record<string, string | null>>({});

  /** Company name for the currently displayed symbol. */
  readonly selectedSymbolName = computed(() => {
    const symbol = this.activeSymbol();
    if (!symbol) return null;
    return this.symbolNameCache()[symbol] ?? null;
  });

  constructor() {
    /**
     * Auto-select the first pane symbol when the source changes and nothing
     * is selected. Skipped while a manual symbol is active.
     */
    effect(() => {
      const symbols = this.viewportSymbols();
      if (symbols.length === 0) return;
      if (!this.selectedSymbol() && !this.manualSymbol()) {
        this.select(symbols[0]);
      }
    });

    /**
     * Viewport-escape guard — a selection that leaves the viewport (the
     * New-only toggle hiding a tracked symbol, a cache update shrinking
     * the pane, a filing echo) advances to the survivor at the dropped
     * symbol's index — the same neighbor-advance advanceQueue uses —
     * or clears when there's nothing left (#1258).
     */
    effect(() => {
      const symbols = this.viewportSymbols();
      const selected = this.selectedSymbol();
      const prev = untracked(this.prevViewport);
      this.prevViewport.set(symbols); // untracked write — mirror bookkeeping, not a dependency
      if (!selected || symbols.includes(selected)) return;
      const idx = prev.indexOf(selected);
      if (idx === -1 || symbols.length === 0) {
        this.selectedSymbol.set(null);
        return;
      }
      // Same survivor-index policy as advanceQueue below.
      this.select(symbols[Math.min(idx, symbols.length - 1)]);
    });

    /**
     * Fetch the company name from the canonical `st-symbols` doc
     * (ST_SYMBOLS_ROOT — cut over in #1159) when the displayed symbol
     * changes and it isn't cached. Untracked symbols resolve to null —
     * the toolbar shows the ticker only.
     */
    effect(() => {
      const symbol = this.activeSymbol();
      if (!symbol) return;
      if (symbol in this.symbolNameCache()) return;
      this.symbolNameCache.update((c) => ({ ...c, [symbol]: null }));
      runInInjectionContext(this.injector, () =>
        getDoc(doc(this.firestore, ST_SYMBOLS_ROOT, symbol)),
      )
        .then((snap) => {
          const name: string | null = snap.exists() ? (snap.data()['name'] ?? null) : null;
          this.symbolNameCache.update((c) => ({ ...c, [symbol]: name }));
        })
        .catch(() => {
          this.symbolNameCache.update((c) => ({ ...c, [symbol]: null }));
        });
    });
  }

  /** Load lists, the tracked universe, the ticket queue, and the latest-run cache. */
  ngOnInit(): void {
    this.symbolListStore.loadSymbolLists();
    this.symbolListStore.loadTrackedSymbols();
    this.ticketStore.loadTickets();
    void this.latestRunStore.loadLatestRuns();
  }

  /** Leave fullscreen mode when the page is destroyed. */
  ngOnDestroy(): void {
    this.uiStateService.setFullscreen(false);
  }

  /** Select a symbol — marks it viewed (dims the pane row) and clears any
   *  manual symbol. Every path that displays a list symbol funnels through
   *  here (pane click, auto-select, prev/next, queue advance): without the
   *  clear, a stale manual value flips the pane into history mode and
   *  pops back via `activeSymbol` if the selection is later cleared. */
  private select(symbol: string): void {
    this.manualSymbol.set(null);
    this.viewedSymbols.update((set) => {
      const next = new Set(set);
      next.add(symbol);
      return next;
    });
    this.selectedSymbol.set(symbol);
  }

  /** Select a symbol from the pane. */
  onSymbolSelected(symbol: string): void {
    this.select(symbol);
  }

  /** Trade the displayed symbol — always the manual order dialog; chart
   *  view has no run provenance to gate on (#1232). */
  onTrade(): void {
    const symbol = this.activeSymbol();
    if (!symbol) return;
    void this.manualOrderService.open(symbol);
  }

  /** Add-to-tracked stub — SA lands the real endpoint separately. */
  onAddToTracked(): void {
    this.snackBar.open('Add to tracked — coming soon', 'Dismiss', { duration: 3000 });
  }

  /** Navigate to the order page. */
  goToOrder(): void {
    void this.router.navigate(['/' + AppRoutes.SIGNAL_ORDER]);
  }

  /** Move the selection to the next pane symbol when a membership toggle
   *  drops the selected symbol out of the filtered viewport. Runs before
   *  the Firestore echo (the store has no optimistic update), so
   *  `viewportSymbols()` still contains the symbol — the `idx === -1`
   *  guard covers an external snapshot shrinking the viewport first. */
  private advanceQueue(removedSymbol: string): void {
    const before = this.viewportSymbols();
    const idx = before.indexOf(removedSymbol);
    const remaining = before.filter((s) => s !== removedSymbol);
    if (idx === -1 || remaining.length === 0) {
      // Clearing hands recovery to the auto-select effect. Note the effect
      // runs against the stale pre-echo viewport — when the last symbol is
      // filed out it may transiently re-select that symbol; post-echo the
      // pane is empty and the escape guard recovers (advances to the
      // symbol's last-known neighbor, or clears if it was never paneed).
      // (Divergence from chart-review's detached-chart parity — deliberate.)
      this.selectedSymbol.set(null);
      return;
    }
    const nextIdx = Math.min(idx, remaining.length - 1);
    this.select(remaining[nextIdx]);
  }

  /** Toggle the displayed symbol's membership in a named list. */
  onToggleList(event: { symbol: string; listKey: string }): void {
    const willLeave = this.willLeaveActiveList(event.symbol, event.listKey);
    this.symbolListStore.toggleSymbolInList(event.symbol, event.listKey);
    // Advance NOW if the write drops the selection out of the viewport —
    // otherwise the index dangles at -1 and nav dies.
    if (willLeave && event.symbol === this.selectedSymbol()) {
      this.advanceQueue(event.symbol);
    }
  }

  /**
   * Whether toggling `listKey` removes `symbol` from the active viewport
   * list. Same prediction the review page used — ported unchanged so the
   * write can advance the queue before the Firestore snapshot arrives.
   */
  private willLeaveActiveList(symbol: string, listKey: string): boolean {
    const filter = this.activeList();
    if (filter === 'ALL') return false;
    const def = this.symbolListStore.byKey().get(listKey);
    if (!def) return false;
    if (filter === NO_MEMBERSHIP) {
      return def.role === 'exclusive' && !def.symbols.includes(symbol.toUpperCase());
    }
    if (def.role === 'exclusive') {
      return this.symbolListStore.byKey().get(filter)?.role === 'exclusive';
    }
    return filter === listKey && def.symbols.includes(symbol.toUpperCase());
  }

  /** Load an arbitrary symbol — charts it whether or not it's tracked. */
  loadManualSymbol(symbolInput: string): void {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    this.selectedSymbol.set(null);
    this.manualSymbol.set(symbol);
  }

  /** Navigate to the previous symbol in the viewport. */
  onPrevSymbol(): void {
    const idx = this.selectedSymbolIndex();
    if (idx <= 0) return;
    this.select(this.viewportSymbols()[idx - 1]);
  }

  /** Navigate to the next symbol in the viewport. */
  onNextSymbol(): void {
    const symbols = this.viewportSymbols();
    const idx = this.selectedSymbolIndex();
    if (idx < 0) {
      // No selection (e.g. a manual symbol was loaded) — Next jumps to the
      // first pane symbol, returning to list mode.
      if (symbols.length > 0) this.select(symbols[0]);
      return;
    }
    if (idx >= symbols.length - 1) return;
    this.select(symbols[idx + 1]);
  }

  /** Source selection — list or scan, one slot in the viewport service.
   *  Clears both selection paths so the new source starts clean. */
  onSourceChange(filter: SymbolListFilter): void {
    this.viewportService.setActiveSource(filter);
    this.manualSymbol.set(null);
    this.selectedSymbol.set(null);
  }
}
