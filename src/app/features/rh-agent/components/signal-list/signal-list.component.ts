/**
 * Signal List Component
 *
 * Master list panel for the review interface.
 */
import { Component, inject, ChangeDetectionStrategy, output, viewChildren, ElementRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

import { RhAgentDashboardStore } from '../../rh-agent-dashboard.store';
import { RhAgentStore } from '../../rh-agent.store';
import { RhTradeSignal } from '../../rh-agent.service';
import { UiStateService } from '../../../../core/services/ui-state.service';

@Component({
  selector: 'app-signal-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatListModule,
    MatIconModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconButton,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './signal-list.component.html',
  styleUrl: './signal-list.component.scss',
})
export class SignalListComponent {
  readonly uiStore = inject(RhAgentDashboardStore);
  readonly dataStore = inject(RhAgentStore);
  readonly uiState = inject(UiStateService);

  signalSelected = output<RhTradeSignal>();

  private listItems = viewChildren<ElementRef>('signalItem');

  constructor() {
    effect(() => {
      const selectedId = this.uiStore.selectedSignalId();
      const items = this.listItems();
      if (!selectedId || !items.length) return;
      const signals = this.signals();
      const idx = signals.findIndex(s => s.id === selectedId);
      if (idx !== -1 && items[idx]) {
        items[idx].nativeElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  signals() {
    const currentRun = this.uiStore.currentRun();
    if (!currentRun) return [];
    return this.uiStore.getFilteredSignals(currentRun.id);
  }

  filteredCount(): number {
    return this.signals().length;
  }

  onSelect(signal: RhTradeSignal): void {
    this.uiStore.selectSignal(signal.id);
    this.signalSelected.emit(signal);
  }
}
