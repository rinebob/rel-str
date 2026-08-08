/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-02)
 *
 * Page component hosting the builder dialog and chart.
 * Symbol input, build spreads button, chart area, pagination controls,
 * underlying toggle, and chart mode toggle.
 */
import { Component, inject, signal, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';

import { SpreadViewerStore } from '../../stores/spread-viewer.store';
import { SpreadChartComponent } from '../../components/spread-chart/spread-chart.component';
import { SpreadBuilderDialogComponent } from '../../components/spread-builder-dialog/spread-builder-dialog.component';
import { SaveListDialogComponent } from '../../components/save-list-dialog/save-list-dialog.component';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { SpreadStatus } from '@spread/contracts';

@Component({
  selector: 'app-spread-chart-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatButtonToggleModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatMenuModule,
    SpreadChartComponent,
  ],
  templateUrl: './spread-chart-page.component.html',
  styleUrl: './spread-chart-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpreadChartPageComponent implements OnInit, OnDestroy {
  readonly store = inject(SpreadViewerStore);
  private readonly dialog = inject(MatDialog);
  private readonly uiStateService = inject(UiStateService);

  symbolInput = signal('QQQ');
  readonly SpreadStatus = SpreadStatus;

  ngOnInit(): void {
    this.uiStateService.setFullscreen(true);
    const sym = this.symbolInput().trim().toUpperCase();
    if (sym) {
      this.store.setSymbol(sym);
    }
  }

  ngOnDestroy(): void {
    this.uiStateService.setFullscreen(false);
  }

  onSymbolChange(value: string): void {
    this.symbolInput.set(value);
  }

  onSymbolEnter(): void {
    const sym = this.symbolInput().trim().toUpperCase();
    if (sym) {
      this.store.setSymbol(sym);
    }
  }

  onBuildSpreads(): void {
    this.dialog.open(SpreadBuilderDialogComponent, {
      width: '640px',
      maxWidth: '90vw',
      maxHeight: '90vh',
    });
  }

  onClearAll(): void {
    this.store.clearSpreads();
  }

  onLoadSpreads(): void {
    this.store.loadSpreads();
  }

  onPrevPage(): void {
    this.store.prevPage();
  }

  onNextPage(): void {
    this.store.nextPage();
  }

  onToggleUnderlying(): void {
    this.store.toggleUnderlying();
  }

  onChartModeChange(mode: 'absolute' | 'normalized'): void {
    this.store.setChartMode(mode);
  }

  onLoadRecent(): void {
    this.store.loadRecentList();
  }

  onLoadNamedList(listId: string): void {
    this.store.loadNamedList(listId);
  }

  onSaveList(): void {
    this.dialog.open(SaveListDialogComponent, {
      width: '400px',
      maxWidth: '90vw',
    }).afterClosed().subscribe((name: string | undefined) => {
      if (name) {
        this.store.saveCurrentList(name);
      }
    });
  }

  onDeleteList(listId: string): void {
    this.store.deleteNamedList(listId);
  }

  onListsMenuOpen(): void {
    this.store.loadNamedLists();
  }
}
