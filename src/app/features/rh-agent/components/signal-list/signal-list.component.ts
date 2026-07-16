/**
 * Signal List Component
 *
 * Master list panel for the review interface.
 */
import { Component, inject, ChangeDetectionStrategy, output, input, viewChildren, ElementRef, effect, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

import { RhAgentSignalItem } from '../../services/rh-agent.types';
import { RhAgentSignalService } from '../../services/rh-agent-signal.service';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { SignalDirection, SignalTimeframe } from '../../common/rh-agent.constants';

@Component({
  selector: 'app-signal-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatIconButton,
    MatTooltipModule,
  ],
  templateUrl: './signal-list.component.html',
  styleUrl: './signal-list.component.scss',
})
export class SignalListComponent {
  readonly signalService = inject(RhAgentSignalService);
  readonly uiStateService = inject(UiStateService);
  readonly SignalDirection = SignalDirection;
  readonly SignalTimeframe = SignalTimeframe;

  /** Currently selected symbol (passed in from parent) */
  selectedSymbol = input<string | null>(null);

  /** Manual symbol override — when set, show this symbol's signal history instead of triage queue */
  manualSymbol = input<string | null>(null);

  /** Viewport symbols — the parent-computed list of symbols to display in the sidebar. */
  symbols = input<string[]>([]);

  /** Symbols that were just added via the new-symbols dialog; shown with a NEW chip. */
  newSymbols = input<string[]>([]);

  symbolSelected = output<string>();

  /** Signal history cache keyed by symbol — reactive so items() computed re-runs on load */
  private signalHistoryCache = signal<Record<string, RhAgentSignalItem[]>>({});

  /** Timeframe filter for history mode: 'all' | daily | weekly */
  timeframeFilter = signal<'all' | SignalTimeframe>('all');

  private listItems = viewChildren('listItem', { read: ElementRef });

  items = computed(() => {
    const cache = this.signalHistoryCache();
    const manual = this.manualSymbol();
    const filter = this.timeframeFilter();
    if (manual) {
      const signals = (cache[manual] ?? []).filter(s => filter === 'all' || s.timeframe === filter);
      return signals.map(s => ({
        symbol: manual,
        latestSignal: s,
        recentSignals: [] as RhAgentSignalItem[],
        isHistoryRow: true,
      }));
    }
    const viewportSymbols = this.symbols();
    return viewportSymbols.map(symbol => {
      const signals = cache[symbol] ?? [];
      return {
        symbol,
        latestSignal: signals[0] ?? null,
        recentSignals: signals.slice(0, 3),
        isHistoryRow: false,
      };
    });
  });

  constructor() {
    /**
     * Load signal history on demand when the selected symbol changes and is not cached.
     */
    effect(() => {
      const symbol = this.selectedSymbol();
      if (!symbol || this.signalHistoryCache()[symbol] !== undefined) return;
      this.signalHistoryCache.update(c => ({ ...c, [symbol]: [] }));
      this.signalService.getSymbolSignalHistoryFromHistory(symbol).subscribe({
        next: (signals) => this.signalHistoryCache.update(c => ({ ...c, [symbol]: signals })),
        error: () => {},
      });
    });

    /**
     * Load signal history when a manual symbol is set. Also resets the filter.
     */
    effect(() => {
      const symbol = this.manualSymbol();
      this.timeframeFilter.set('all');
      if (!symbol || this.signalHistoryCache()[symbol] !== undefined) return;
      this.signalHistoryCache.update(c => ({ ...c, [symbol]: [] }));
      this.signalService.getSymbolSignalHistoryFromHistory(symbol).subscribe({
        next: (signals) => this.signalHistoryCache.update(c => ({ ...c, [symbol]: signals })),
        error: () => {},
      });
    });

    /**
     * Scroll the selected symbol into view in the virtual list.
     */
    effect(() => {
      const sel = this.selectedSymbol();
      const listItems = this.listItems();
      if (!sel || !listItems.length) return;
      const viewportSymbols = this.symbols();
      const idx = viewportSymbols.indexOf(sel);
      if (idx !== -1 && listItems[idx]) {
        listItems[idx].nativeElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  onSelect(symbol: string): void {
    this.symbolSelected.emit(symbol);
  }
}
