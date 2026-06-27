/**
 * Signal List Component
 *
 * Master list panel for the review interface.
 */
import { Component, inject, ChangeDetectionStrategy, output, input, viewChildren, ElementRef, effect, computed } from '@angular/core';
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

  symbolSelected = output<string>();

  /** Signal history cache keyed by symbol */
  private signalHistoryCache = new Map<string, RhAgentSignalItem[]>();

  private listItems = viewChildren<ElementRef>('listItem');

  items = computed(() => {
    const symbols = this.triageStore.reviewSymbols();
    return symbols.map(symbol => ({
      symbol,
      latestSignal: this.signalHistoryCache.get(symbol)?.[0] ?? null,
    }));
  });

  constructor() {
    effect(() => {
      const symbol = this.selectedSymbol();
      if (!symbol || this.signalHistoryCache.has(symbol)) return;
      this.service.getSymbolSignalHistory(symbol).subscribe({
        next: (signals) => this.signalHistoryCache.set(symbol, signals),
        error: () => this.signalHistoryCache.set(symbol, []),
      });
    });

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
