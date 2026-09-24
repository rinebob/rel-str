/**
 * Option Chain Page
 *
 * Single-session option chain browser. Renders a full chain in
 * strikes x expirations matrix form — the pct-change grid's visual
 * layout — showing mark price, change vs the prior session, delta,
 * and IV per contract, with the full payload on hover.
 *
 * Header controls: symbol input + Load, CALLS/PUTS/BOTH layout, per-side
 * strike orientation, delta bounds, delta/time/heatmap shading toggles,
 * re-sync, and the expiration column picker (persisted per symbol).
 * Grids: #501 layout, #502 icon-hover popup.
 */
import { Component, ChangeDetectionStrategy, computed, effect, ElementRef, inject, OnDestroy, OnInit, signal, viewChildren } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { OptionChainStore } from './option-chain.store';
import { ChainGridComponent } from './components/chain-grid.component';
import { buildChainGrid, type ChainGridModel, type StrikeOrientation } from './utils/chain.utils';
import { OptionType } from '@options-contract/contracts';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { sessionPctChange } from '../../utils/option-grid.utils';
import { ColumnPickerComponent } from './components/column-picker.component';

/** Which side panes are shown — both is calls left + puts right. */
type SideLayout = 'call' | 'put' | 'both';

@Component({
  selector: 'app-option-chain',
  standalone: true,
  imports: [ChainGridComponent, ColumnPickerComponent, DecimalPipe],
  templateUrl: './option-chain.component.html',
  styleUrl: './option-chain.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionChainComponent implements OnInit, OnDestroy {
  protected readonly store = inject(OptionChainStore);
  protected readonly OptionType = OptionType;
  private readonly ui = inject(UiStateService);

  /** CALLS / PUTS / BOTH pane layout — pure view state. */
  readonly layout = signal<SideLayout>('both');

  /** Per-side strike ordering — each pane flips independently (the single
   *  visible pane's toggle applies in CALLS/PUTS mode). */
  readonly callOrientation = signal<StrikeOrientation>('desc');
  readonly putOrientation = signal<StrikeOrientation>('asc');

  /** |delta| filter bounds — same semantics as the pct-change page:
   *  missing delta fails the filter. Unbounded by default; entering a
   *  bound enables it, clearing the input unbounds that side. */
  readonly deltaGte = signal<number | null>(null);
  readonly deltaLte = signal<number | null>(null);

  /** Visual-layer toggles — both default on. */
  readonly deltaShading = signal(true);
  readonly timeShading = signal(true);
  /** Gradient + top-gainer rings share one toggle — same layer. */
  readonly heatmap = signal(true);

  /** Columns picker — hidden expirations (empty = all shown), persisted
   *  to localStorage scoped per symbol so column choices for QQQ don't
   *  bleed into SPY. Applies to both grids via the models' filter. The
   *  store clears the chain on symbol change, so keying on symbol() is
   *  the loaded-symbol key — the picker writes to whichever symbol's
   *  chain is loaded. */
  private static readonly HIDDEN_KEY = 'option-chain.hidden-expirations';
  readonly hiddenExpirations = signal<ReadonlySet<string>>(new Set());
  private hiddenKey(): string {
    return `${OptionChainComponent.HIDDEN_KEY}.${this.store.symbol()}`;
  }

  private loadHiddenExpirations(): ReadonlySet<string> {
    try {
      const raw = localStorage.getItem(this.hiddenKey());
      const arr: unknown = raw ? JSON.parse(raw) : null;
      return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  }

  /** Reload the hidden set when the symbol changes — declared BEFORE
   *  persistHidden so first-run order loads the saved set before the
   *  persist effect writes it (an empty write first would clobber it). */
  private readonly reloadHiddenOnSymbol = effect(() => {
    this.store.symbol();
    this.hiddenExpirations.set(this.loadHiddenExpirations());
  });

  /** Persist whenever the hidden set changes — keyed to the current
   *  (loaded) symbol. */
  private readonly persistHidden = effect(() => {
    const set = this.hiddenExpirations();
    try {
      // Empty set → remove the key rather than writing '[]' — keeps
      // partial-symbol keys (Q → QQ while typing) from littering storage.
      if (set.size === 0) localStorage.removeItem(this.hiddenKey());
      else localStorage.setItem(this.hiddenKey(), JSON.stringify([...set]));
    } catch { /* storage unavailable — selection stays session-local */ }
  });

  /** All expirations present in the session snapshot — the picker's
   *  checkbox list. Computed from raw contracts (not the models) so it
   *  isn't circular with hiddenExpirations. */
  readonly allExpirations = computed(() => {
    const set = new Set<string>();
    for (const c of this.store.sessionContracts()) {
      if (c.expiration) set.add(c.expiration);
    }
    return [...set].sort();
  });

  onDeltaBound(which: 'deltaGte' | 'deltaLte', event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    const n = v === '' ? null : Number(v);
    this[which].set(n !== null && Number.isFinite(n) ? n : null);
  }

  toggleOrientation(side: 'call' | 'put'): void {
    const s = side === 'call' ? this.callOrientation : this.putOrientation;
    s.update((o) => (o === 'desc' ? 'asc' : 'desc'));
  }

  /** BOTH-mode scroll sync — scroll doesn't bubble but DOES propagate in
   *  the capture phase, so one capture listener on the page host sees
   *  every pane scroll. The sibling is positioned by scroll FRACTION, not
   *  absolute offset — the panes have different scrollable extents, so
   *  absolute copies drift and compound; a fraction recomputes from the
   *  source's current position every event and cannot accumulate error. */
  private readonly onGridsScroll = (event: Event): void => {
    const src = event.target as HTMLElement | null;
    if (!src?.classList?.contains('grid-scroll')) return;
    // A re-sync scrolls both panes programmatically — a queued scroll event
    // at exactly the position resync wrote is that programmatic event:
    // skip it once so it can't mirror its ATM fraction onto the sibling
    // and undo the centering. (Position-matched, not time-windowed — a
    // real user scroll to a different position during re-sync still
    // mirrors normally.)
    const expected = this.expectedScrolls.get(src);
    if (
      expected &&
      src.scrollTop === expected.top &&
      src.scrollLeft === expected.left
    ) {
      this.expectedScrolls.delete(src);
      return;
    }
    const vRange = src.scrollHeight - src.clientHeight;
    const hRange = src.scrollWidth - src.clientWidth;
    const vFrac = vRange > 0 ? src.scrollTop / vRange : 0;
    const hFrac = hRange > 0 ? src.scrollLeft / hRange : 0;
    for (const s of this.gridScrollers()) {
      if (s === src) continue;
      const dstV = s.scrollHeight - s.clientHeight;
      const dstH = s.scrollWidth - s.clientWidth;
      if (dstV > 0) s.scrollTop = vFrac * dstV;
      if (dstH > 0) s.scrollLeft = hFrac * dstH;
    }
  };

  /** .grid-scroll elements, cached — layout() flips recreate them. */
  private scrollerCache: HTMLElement[] | null = null;
  private gridScrollers(): HTMLElement[] {
    if (this.scrollerCache === null) {
      this.scrollerCache = Array.from(
        this.host.nativeElement.querySelectorAll<HTMLElement>('.grid-scroll'),
      );
    }
    return this.scrollerCache;
  }

  /** Re-sync: center both panes on their own ATM strike row. Each pane's
   *  resulting scroll event is suppressed by position-match in
   *  onGridsScroll (above) so neither pane's centering overwrites the
   *  other's. */
  private readonly grids = viewChildren(ChainGridComponent);
  private readonly expectedScrolls = new Map<HTMLElement, { top: number; left: number }>();

  /** Layout flips (both ↔ single pane) recreate the scroller elements —
   *  drop the cache so the next scroll event re-queries. */
  private readonly invalidateScrollers = effect(() => {
    this.layout();
    this.scrollerCache = null;
  });

  resync(): void {
    for (const g of this.grids()) g.centerAtm();
    for (const s of this.gridScrollers()) {
      this.expectedScrolls.set(s, { top: s.scrollTop, left: s.scrollLeft });
    }
    // Stale entries (a pane that was already centered fires no event)
    // would otherwise suppress a coincidental future scroll to the same
    // position — expire them after the events have had time to dispatch.
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.expectedScrolls.clear();
    }, 50);
  }
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Full-screen page like the other savant-trader tools — the chain grid
   *  wants the whole viewport. Auto-loads the default symbol. */
  ngOnInit(): void {
    this.ui.setFullscreen(true);
    this.host.nativeElement.addEventListener('scroll', this.onGridsScroll, true);
    if (this.store.symbol()) this.store.loadChain();
  }

  ngOnDestroy(): void {
    this.ui.setFullscreen(false);
    this.host.nativeElement.removeEventListener('scroll', this.onGridsScroll, true);
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  protected readonly callsModel = computed(() =>
    buildChainGrid(
      this.store.sessionContracts(),
      this.store.priorContracts(),
      OptionType.CALL,
      {
        spot: this.store.sessionClose(),
        orientation: this.callOrientation(),
        filter: {
          deltaGte: this.deltaGte(),
          deltaLte: this.deltaLte(),
          excludeExpirations: this.hiddenExpirations(),
        },
      },
    ),
  );

  protected readonly putsModel = computed(() =>
    buildChainGrid(
      this.store.sessionContracts(),
      this.store.priorContracts(),
      OptionType.PUT,
      {
        spot: this.store.sessionClose(),
        orientation: this.putOrientation(),
        filter: {
          deltaGte: this.deltaGte(),
          deltaLte: this.deltaLte(),
          excludeExpirations: this.hiddenExpirations(),
        },
      },
    ),
  );

  /** Underlying session-vs-prior % change — "+0.24%", 'n/a' on a zero
   *  prior close (division guard, mirrors the cell-level rule). */
  readonly underlyingPct = computed(() =>
    sessionPctChange(this.store.sessionClose(), this.store.priorClose(), 2),
  );

  /** Underlying direction — drives the per-column top-5 ring: up day →
   *  calls highlight gainers, puts losers; down day inverts. Flat/missing
   *  closes → null → no rings (a directionless top-5 is meaningless). */
  readonly underlyingDir = computed<'up' | 'down' | null>(() => {
    const cur = this.store.sessionClose();
    const prev = this.store.priorClose();
    if (cur == null || prev == null || cur === prev) return null;
    return cur > prev ? 'up' : 'down';
  });

  readonly callsTopDir = computed<'gainers' | 'losers' | null>(() => {
    const dir = this.underlyingDir();
    return dir === null ? null : dir === 'down' ? 'losers' : 'gainers';
  });
  readonly putsTopDir = computed<'gainers' | 'losers' | null>(() => {
    const dir = this.underlyingDir();
    return dir === null ? null : dir === 'up' ? 'losers' : 'gainers';
  });

  /** Per-pane strike stats — ATM + displayed range + row count vs total.
   *  Computed so the template is render-only. Null when the model has no
   *  rows. */
  private statsFor(m: ChainGridModel | null) {
    if (!m?.rows.length) return null;
    const strikes = m.rows.map((r) => r.strike);
    return {
      atm: m.atmStrike,
      lo: Math.min(...strikes),
      hi: Math.max(...strikes),
      n: strikes.length,
      total: m.totalStrikes,
    };
  }

  readonly callsStats = computed(() => this.statsFor(this.callsModel()));
  readonly putsStats = computed(() => this.statsFor(this.putsModel()));

  onSymbolInput(event: Event): void {
    this.store.setSymbol((event.target as HTMLInputElement).value);
  }

  onLoad(): void {
    this.store.loadChain();
  }
}
