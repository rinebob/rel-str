/**
 * New Symbols Dialog
 *
 * Lets the user surface symbols for review:
 *   - Symbols added via partner-symbol-added with source 'manual-add'
 *     within the last N days.
 *   - Enabled symbols that are not in any user-defined list yet.
 *
 * Selected symbols are returned so the caller can add them to the review queue.
 */
import { Component, ChangeDetectionStrategy, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { SignalService } from '../../services/signal.service';
import { SymbolListStore } from '../../stores/symbol-list.store';
import { StSymbolProfile } from '../../services/types';

/** Search modes available in the new-symbols dialog. */
export enum SearchMode {
  NEWLY_ADDED = 'newly-added',
  UNBACKFILLED = 'unbackfilled',
}

@Component({
  selector: 'app-new-symbols-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './new-symbols-dialog.component.html',
  styleUrl: './new-symbols-dialog.component.scss',
})
export class NewSymbolsDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<NewSymbolsDialogComponent, string[] | undefined>);
  private readonly signalService = inject(SignalService);
  private readonly symbolListStore = inject(SymbolListStore);

  /** SearchMode enum exposed for the template. */
  readonly searchModes = SearchMode;

  /** Current search mode. */
  searchMode = signal<SearchMode>(SearchMode.NEWLY_ADDED);

  /** Number of days back to search (only for newly-added mode). Default 7. */
  daysBack = signal<number>(7);

  /** True while fetching symbols from Firestore. */
  loading = signal<boolean>(false);

  /** Error message if the query fails. */
  error = signal<string | null>(null);

  /** Symbols returned by the last query, sorted by createdAt descending. */
  symbols = signal<StSymbolProfile[]>([]);

  /** Symbols the user has selected for adding to the review queue. */
  selectedSymbols = signal<Set<string>>(new Set());

  /** Whether every displayed symbol is selected. */
  allSelected = computed(() => this.symbols().length > 0 && this.selectedSymbols().size === this.symbols().length);

  ngOnInit(): void {
    this.symbolListStore.loadSymbolLists();
  }

  /** Fetch symbols based on the active search mode. */
  findSymbols(): void {
    this.loading.set(true);
    this.error.set(null);
    this.symbols.set([]);
    this.selectedSymbols.set(new Set());

    const mode = this.searchMode();
    const query$ =
      mode === SearchMode.NEWLY_ADDED
        ? this.signalService.getSymbolsAddedSince(Math.max(1, this.daysBack()))
        : this.signalService.getUnbackfilledSymbols(this.listSymbols());

    query$.subscribe({
      next: (profiles: StSymbolProfile[]) => {
        const sorted = [...profiles].sort((a, b) =>
          (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
        );
        this.symbols.set(sorted);
        this.selectedSymbols.set(new Set(sorted.map((p) => p.symbol)));
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        this.error.set(`Failed to load symbols: ${message}`);
        this.loading.set(false);
      },
    });
  }

  /** All symbols currently belonging to any user-defined list. */
  private listSymbols(): string[] {
    return Object.values(this.symbolListStore.symbolLists()).flat();
  }

  /** Toggle selection for every displayed symbol. */
  toggleSelectAll(): void {
    if (this.allSelected()) {
      this.selectedSymbols.set(new Set());
    } else {
      this.selectedSymbols.set(new Set(this.symbols().map((p) => p.symbol)));
    }
  }

  /** Toggle a single symbol's selection. */
  toggleSymbol(symbol: string): void {
    const next = new Set(this.selectedSymbols());
    if (next.has(symbol)) {
      next.delete(symbol);
    } else {
      next.add(symbol);
    }
    this.selectedSymbols.set(next);
  }

  /** Close the dialog and return the selected symbols. */
  addToReview(): void {
    this.dialogRef.close([...this.selectedSymbols()]);
  }

  /** Close the dialog without returning symbols. */
  close(): void {
    this.dialogRef.close(undefined);
  }
}
