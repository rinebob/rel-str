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
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

import { OptionChainStore } from './option-chain.store';
import { ChainGridComponent } from './components/chain-grid.component';
import { buildChainGrid, type ChainGridModel, type StrikeOrientation } from './utils/chain.utils';
import { invalidIsoDateMessage, isValidIsoDate } from './utils/session-resolution.utils';
import { OptionType } from '@options-contract/contracts';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { SymbolListStore } from '../../stores/symbol-list.store';
import { effectiveHiddenExpirations } from './utils/column-visibility.utils';
import { sessionPctChange } from '../../utils/option-grid.utils';
import { ColumnPickerComponent } from './components/column-picker.component';

/** Which side panes are shown — both is calls left + puts right. */
type SideLayout = 'call' | 'put' | 'both';

@Component({
  selector: 'app-option-chain',
  standalone: true,
  imports: [ChainGridComponent, ColumnPickerComponent, DecimalPipe, MatDatepickerModule, MatNativeDateModule],
  templateUrl: './option-chain.component.html',
  styleUrl: './option-chain.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionChainComponent implements OnInit, OnDestroy {
  protected readonly store = inject(OptionChainStore);
  /** Tracked-symbol profiles — company name in the header (SOT:
   *  profile.name; untracked symbols show the bare ticker). */
  protected readonly lists = inject(SymbolListStore);
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

  /** Strike-range filter — empty = unbounded, same idiom as delta. */
  readonly strikeGte = signal<number | null>(null);
  readonly strikeLte = signal<number | null>(null);

  /** Visual-layer toggles — both default on. */
  readonly deltaShading = signal(true);
  readonly timeShading = signal(true);
  /** Gradient + top-gainer rings share one toggle — same layer. */
  readonly heatmap = signal(true);

  /** Columns picker state — deselected DTE band ids + per-expiration
   *  overrides (expHidden hides within a shown band, expShown resurrects
   *  within a hidden band). Persisted per symbol as {b,h,s}; band ids
   *  re-derive against the current session's DTEs on every date change,
   *  so buckets track windows rather than frozen dates. The store clears
   *  the chain on symbol change, so keying on symbol() is the
   *  loaded-symbol key. */
  private static readonly HIDDEN_KEY = 'option-chain.hidden-expirations';
  readonly hiddenBands = signal<ReadonlySet<string>>(new Set());
  readonly expHidden = signal<ReadonlySet<string>>(new Set());
  readonly expShown = signal<ReadonlySet<string>>(new Set());
  private hiddenKey(): string {
    return `${OptionChainComponent.HIDDEN_KEY}.${this.store.symbol()}`;
  }

  private static strSet(v: unknown): Set<string> {
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  }

  private loadColumnState(): void {
    try {
      const raw = localStorage.getItem(this.hiddenKey());
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        // Legacy shape: bare array of hidden dates → expHidden.
        this.hiddenBands.set(new Set());
        this.expHidden.set(OptionChainComponent.strSet(parsed));
        this.expShown.set(new Set());
        return;
      }
      const o = (parsed ?? {}) as {
        bands?: unknown; hidden?: unknown; shown?: unknown;
        b?: unknown; h?: unknown; s?: unknown; // first-write key names
      };
      this.hiddenBands.set(OptionChainComponent.strSet(o.bands ?? o.b));
      this.expHidden.set(OptionChainComponent.strSet(o.hidden ?? o.h));
      this.expShown.set(OptionChainComponent.strSet(o.shown ?? o.s));
    } catch {
      // Corrupt value → all visible — must reset, not keep the
      // previous symbol's sets.
      this.hiddenBands.set(new Set());
      this.expHidden.set(new Set());
      this.expShown.set(new Set());
    }
  }

  /** Reload the column state when the symbol changes — declared BEFORE
   *  persistColumns so first-run order loads the saved state before the
   *  persist effect writes it (an empty write first would clobber it). */
  private readonly reloadColumnsOnSymbol = effect(() => {
    this.store.symbol();
    this.loadColumnState();
  });

  /** Persist whenever any column-state set changes — keyed to the
   *  current (loaded) symbol. */
  private readonly persistColumns = effect(() => {
    const b = this.hiddenBands();
    const h = this.expHidden();
    const s = this.expShown();
    try {
      // All empty → remove the key rather than writing an empty object —
      // keeps partial-symbol keys (Q → QQ while typing) from littering.
      if (!b.size && !h.size && !s.size) {
        localStorage.removeItem(this.hiddenKey());
      } else {
        localStorage.setItem(
          this.hiddenKey(),
          JSON.stringify({ bands: [...b], hidden: [...h], shown: [...s] }),
        );
      }
    } catch { /* storage unavailable — selection stays session-local */ }
  });

  /** All expirations present in the session snapshot — the picker's
   *  checkbox list. Computed from raw contracts (not the models) so it
   *  isn't circular with the column-filter state. */
  readonly allExpirations = computed(() => {
    const set = new Set<string>();
    for (const c of this.store.sessionContracts()) {
      if (c.expiration) set.add(c.expiration);
    }
    return [...set].sort();
  });

  /** Hidden columns for the CURRENT session — band ids re-evaluate
   *  against this session's DTEs every time the date changes, so a
   *  deselected bucket keeps hiding its band as expirations shift. */
  readonly effectiveHidden = computed(() =>
    effectiveHiddenExpirations(
      this.allExpirations(),
      this.store.resolvedDate(),
      this.hiddenBands(),
      this.expHidden(),
      this.expShown(),
    ),
  );

  /** Numeric bound inputs (|Δ| and strike range share the parse: empty
   *  = unbounded, non-finite = unbounded). */
  onBound(
    which: 'deltaGte' | 'deltaLte' | 'strikeGte' | 'strikeLte',
    event: Event,
  ): void {
    const v = (event.target as HTMLInputElement).value;
    const n = v === '' ? null : Number(v);
    this[which].set(n !== null && Number.isFinite(n) ? n : null);
  }

  /** Inline validation for manual date entry — shown next to the input
   *  WITHOUT fetching (the store's error path replaces the whole grid). */
  readonly dateError = signal<string | null>(null);
  /** Company display name from the tracked-symbol profile. */
  readonly companyName = computed(
    () => this.lists.profilesBySymbol().get(this.store.symbol())?.name ?? null,
  );

  /** Enter-key entry point — keeps $event.target casts out of the template. */
  onDateCommitEvent(event: Event): void {
    this.onDateCommit((event.target as HTMLInputElement).value);
  }

  /** Manual date commit (Enter) — validates first; invalid input sets an
   *  inline message and never reaches the store/fetch path. Clearing the
   *  box and committing re-resolves the latest session (same as Today). */
  onDateCommit(raw: string): void {
    const v = raw.trim();
    if (v === '') {
      this.dateError.set(null);
      this.store.loadToday();
      return;
    }
    if (!isValidIsoDate(v)) {
      this.dateError.set(invalidIsoDateMessage(v));
      return;
    }
    this.dateError.set(null);
    this.store.setDateInput(v);
    this.store.loadChain();
  }

  /** Datepicker commit — the native adapter hands us a local-midnight
   *  Date; format its LOCAL parts (toISOString would shift back a day). */
  onPickedDate(d: Date | null): void {
    if (!d || isNaN(d.getTime())) return;
    const p = (n: number) => String(n).padStart(2, '0');
    this.onDateCommit(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  }

  toggleOrientation(side: 'call' | 'put'): void {
    const s = side === 'call' ? this.callOrientation : this.putOrientation;
    s.update((o) => (o === 'desc' ? 'asc' : 'desc'));
    // The flipped pane's auto-center emits `centered` → resync() —
    // re-anchors both panes on their ATMs.
  }

  /** BOTH-mode scroll sync — scroll doesn't bubble but DOES propagate in
   *  the capture phase, so one capture listener on the page host sees
   *  every pane scroll. Sync is ABSOLUTE-FROM-BASELINE: each pane maps
   *  the source's offset-from-aligned-position onto its own baseline.
   *  Recomputed from scratch on every event — a boundary clamp (top or
   *  bottom of the shorter pane) self-heals on the way back, so no gap
   *  can persist. Same-direction motion is correct for both orientation
   *  modes (opposite orientations are how OTM-at-top is expressed).
   *
   *  Programmatic writes (sync + re-sync + auto-center) fire scroll
   *  events that map the source back onto itself — a no-op write, so no
   *  suppression bookkeeping is needed. WeakMap keys GC dead scroller
   *  elements on rebuilds; first-seen panes seed their baseline lazily
   *  (panes are auto-centered → aligned → a valid baseline). */
  private syncBaselines = new WeakMap<HTMLElement, { top: number; left: number }>();

  private readonly onGridsScroll = (event: Event): void => {
    const src = event.target as HTMLElement | null;
    if (!src?.classList?.contains('grid-scroll')) return;
    if (!this.syncBaselines.has(src)) {
      this.syncBaselines.set(src, { top: src.scrollTop, left: src.scrollLeft });
    }
    const srcBase = this.syncBaselines.get(src)!;
    for (const g of this.grids()) {
      const s = g.scrollerEl();
      if (!s || s === src) continue;
      if (!this.syncBaselines.has(s)) {
        this.syncBaselines.set(s, { top: s.scrollTop, left: s.scrollLeft });
      }
      const sibBase = this.syncBaselines.get(s)!;
      s.scrollTop = sibBase.top + (src.scrollTop - srcBase.top);
      s.scrollLeft = sibBase.left + (src.scrollLeft - srcBase.left);
    }
  };

  /** Re-sync: center each pane on its own ATM strike (middle row when no
   *  spot is available) and re-anchor the sync baselines there — the
   *  aligned state offset 0 maps onto. */
  private readonly grids = viewChildren(ChainGridComponent);

  resync(): void {
    for (const g of this.grids()) g.centerAtm();
    for (const g of this.grids()) {
      const s = g.scrollerEl();
      if (s) this.syncBaselines.set(s, { top: s.scrollTop, left: s.scrollLeft });
    }
  }

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Full-screen page like the other savant-trader tools — the chain grid
   *  wants the whole viewport. Auto-loads the default symbol. */
  ngOnInit(): void {
    this.ui.setFullscreen(true);
    this.host.nativeElement.addEventListener('scroll', this.onGridsScroll, true);
    this.lists.loadProfiles();
    if (this.store.symbol()) this.store.loadChain();
  }

  ngOnDestroy(): void {
    this.ui.setFullscreen(false);
    this.host.nativeElement.removeEventListener('scroll', this.onGridsScroll, true);
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
          strikeGte: this.strikeGte(),
          strikeLte: this.strikeLte(),
          excludeExpirations: this.effectiveHidden(),
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
          strikeGte: this.strikeGte(),
          strikeLte: this.strikeLte(),
          excludeExpirations: this.effectiveHidden(),
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

  /** Any model rebuild (new session, filters, orientation, late-arriving
   *  prior data) invalidates the sync baselines — they describe the
   *  ALIGNED state, which a rebuild can change. Each pane re-seeds on
   *  its next scroll event (auto-center or user), keeping the seeded
   *  pair consistent. Declared after the models — field order. */
  private readonly resetSyncOnRebuild = effect(() => {
    this.callsModel();
    this.putsModel();
    this.syncBaselines = new WeakMap();
  });

  onSymbolInput(event: Event): void {
    this.store.setSymbol((event.target as HTMLInputElement).value);
  }

  onLoad(): void {
    this.store.loadChain();
  }
}
