/**
 * Option chart page context — the shared page-level state every
 * coordination unit reads (symbol, OCC input, page-level list error)
 * plus the symbol-switch orchestration that touches every store.
 * Page-scoped: provided by the component, dies with the page, never
 * root-provided.
 */
import { Injectable, computed, inject, signal } from '@angular/core';

import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import { OptionGroupGeneratorStore } from '../../stores/option-group-generator.store';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';

/** Visible chart extents for the filter-to-chart query. */
export interface ChartExtents {
  startDate: string | null;
  endDate: string | null;
  priceLow: number;
  priceHigh: number;
}

@Injectable()
export class OptionChartPageService {
  private readonly store = inject(OptionsContractViewerStore);
  private readonly genStore = inject(OptionGroupGeneratorStore);
  private readonly listStore = inject(ContractListSessionStore);

  /** Current underlying — builder field shared by the catalog query,
   *  the list-session scope, the replay pick, and chart loads. */
  readonly symbol = signal('QQQ');

  /** Contract-type builder field — 'both' is catalog-only (no OCC id). */
  readonly type = signal<'call' | 'put' | 'both'>('both');

  /** Maps the type signal to the SA catalog type param: 'C' | 'P' | null (null = both). */
  readonly catalogType = computed<'C' | 'P' | null>(() => {
    const t = this.type();
    return t === 'call' ? 'C' : t === 'put' ? 'P' : null;
  });

  /** OCC id / pair-lines input — written by the builder, catalog row
   *  pick, replay pick, and programmatic sends; read by the load flow. */
  occIdInput = '';

  /** Contract-list session errors (?list= / chooser) — named, never
   *  silent. Lives here so every symbol-switch path clears it. */
  readonly listError = signal<string | null>(null);

  /** Chart-extents hook — the catalog's filter-to-chart reads the
   *  chart's visible window through this; the page component assigns it
   *  (the chart viewChild lives there). */
  chartExtents: () => ChartExtents | null = () => null;

  /** Post-swap hook — fires after every symbol switch so listeners can
   *  drop swap-scoped state the page service can't reach (the load
   *  service injects THIS service — DI can't run the other direction).
   *  The page component assigns the rejection-notice clear. */
  onSymbolSwitched: () => void = () => {};

  /** First-load session setup — same tail as the symbol switch. The
   *  viewer store is root-provided and survives page teardown, so a
   *  previous visit's plotted set can still be mounted — reset it the
   *  same way a swap does. */
  initSession(): void {
    this.store.resetSession();
    const sym = this.symbol().trim().toUpperCase();
    this.store.setCatalogBuilder({ symbol: sym, type: this.catalogType() });
    this.genStore.setSymbol(sym);
    this.listStore.setSymbol(sym);
    this.loadSymbolData(sym);
  }

  /** Symbol switch — clears the builder input + catalog state, swaps
   *  every per-symbol store/session, and reloads the symbol's data. A
   *  stale page-level list error must not follow the swap (it would
   *  also mask a fresh restore failure via listErrorText's precedence). */
  onSymbolChange(value: string): void {
    this.symbol.set(value);
    this.occIdInput = '';
    this.store.clearCatalog();
    this.store.clearCatalogFilters();
    this.store.setCatalogBuilder({ symbol: value, type: this.catalogType() });
    // The generator + list session keep per-symbol state — swap both blobs.
    this.genStore.setSymbol(value);
    this.listStore.setSymbol(value);
    this.listError.set(null);
    // A swap starts a new session — the prior symbol's plotted series,
    // chips, focus, hover/pin, and loaded contract data must not render
    // over the new underlying. In-flight loads are safe: loadPlotted
    // workers only patch a record still in 'loading' (the clear removes
    // it), and loadContractInternal drops responses orphaned by the
    // reset's seq bump.
    this.store.resetSession();
    this.onSymbolSwitched();
    this.loadSymbolData(value.trim().toUpperCase());
  }

  private loadSymbolData(sym: string): void {
    if (!sym) return;
    this.store.loadContractIndex(sym);
    this.store.loadCatalogSummary(sym);
    this.store.loadUnderlyingBars(sym);
  }
}
