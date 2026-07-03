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

import { RhAgentTriageStore } from '../../stores/rh-agent-triage.store';
import { RhAgentService, RhAgentSignalItem } from '../../services/rh-agent.service';
import { UiStateService } from '../../../../core/services/ui-state.service';

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
  readonly triageStore = inject(RhAgentTriageStore);
  readonly service = inject(RhAgentService);
  readonly uiState = inject(UiStateService);

  /** Currently selected symbol (passed in from parent) */
  selectedSymbol = input<string | null>(null);

  /** Manual symbol override — when set, show this symbol's signal history instead of triage queue */
  manualSymbol = input<string | null>(null);

  symbolSelected = output<string>();

  /** Signal history cache keyed by symbol — reactive so items() computed re-runs on load */
  private signalHistoryCache = signal<Record<string, RhAgentSignalItem[]>>({});

  /** Timeframe filter for history mode: 'all' | 'D' | 'W' */
  timeframeFilter = signal<'all' | 'D' | 'W'>('all');

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
    const symbols = this.triageStore.reviewSymbols();
    return symbols.map(symbol => {
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
      this.service.getSymbolSignalHistoryFromHistory(symbol).subscribe({
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
      this.service.getSymbolSignalHistoryFromHistory(symbol).subscribe({
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
      const symbols = this.triageStore.reviewSymbols();
      const idx = symbols.indexOf(sel);
      if (idx !== -1 && listItems[idx]) {
        listItems[idx].nativeElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  onSelect(symbol: string): void {
    this.symbolSelected.emit(symbol);
  }
}
