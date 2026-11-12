/**
 * Contract-list wiring — `?list=` deep link, chooser → doc tail, picker
 * dialog lifecycle, and the picker's Send handoff into the load flow.
 * Page-scoped: resolves the same ContractListSessionStore instance the
 * page provides, so the picker dialog (opened on the element injector)
 * shares the session.
 */
import { Injectable, inject, computed, Injector, DestroyRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, distinctUntilChanged, map } from 'rxjs';

import { DsDialogRef, DsDialogService } from '../../../../shared/ds/ds-dialog';
import {
  ContractListSessionStore,
  contractListDocError,
} from '../../stores/contract-list-session.store';
import { ContractListService } from '../../services/contract-list.service';
import { OptionsAnalysisRunsService } from '../../backtest/services/options-analysis-runs.service';
import { EXIT_REGISTRY_VERSION } from '@options-analysis/registry';
import type { AnalysisResultDoc } from '@options-analysis/contracts';
import { resultDocToPlottedEntries } from '../../utils/analysis-results-emit.util';
import type { OptionsContractListUi } from '../../backtest/common/options-replay.types';
import { ContractListChooserComponent } from '../../components/contract-list-chooser/contract-list-chooser.component';
import {
  ContractListPickerComponent,
  type ContractListPickerData,
} from '../../components/contract-list-picker/contract-list-picker.component';
import { OptionChartPageService } from './option-chart-page.service';
import { OptionChartLoadService } from './option-chart-load.service';

@Injectable()
export class OptionChartListService {
  private readonly page = inject(OptionChartPageService);
  private readonly load = inject(OptionChartLoadService);
  private readonly listStore = inject(ContractListSessionStore);
  private readonly listService = inject(ContractListService);
  private readonly analysisService = inject(OptionsAnalysisRunsService);
  private readonly dialog = inject(DsDialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  /** Dialogs resolving page-scoped stores (the list session) must open on
   *  this element injector — without it DsDialogService uses the root. */
  private readonly injector = inject(Injector);

  /** Page-level list error — owned by the page service so every
   *  symbol-switch path clears it. */
  private readonly listError = this.page.listError;

  /** Rendered list error — the page-level error wins; a store-level
   *  failure (e.g. a stale persisted docId failing restore) still
   *  surfaces instead of leaving a silent empty session. */
  readonly listErrorText = computed(
    () => this.listError() ?? this.listStore.error(),
  );

  /** Picker emit → chart handoff — injected into the dialog via
   *  DS_DIALOG_DATA so Send can plot through the page's load path. A
   *  root `effect` on `lastEmitted` was the planned seam but deadlocks
   *  the zoneless scheduler while Zone.js is still loaded (NG0914
   *  state), so the callback is explicit: emitters call store.send*
   *  then this. */
  readonly emitSessionLines = (lines: string[]): void => {
    if (lines.length) this.load.emitLinesToChart(lines);
  };

  /** Ordering guard for `onContractListDocId` — two sequential `?list=`
   *  links resolve their fetches out of order; only the latest applies
   *  (the store's loadSeq can't help — every loadListDoc is a legit
   *  fresh apply). */
  private listDocReqSeq = 0;

  /** Live picker ref — a `?list=` doc applying while the picker is
   *  open must not stack a second dialog; the open one already tracks
   *  the store, so the new selection/chunk state shows through. */
  private pickerRef: DsDialogRef<ContractListPickerComponent> | null = null;

  /** `?list={docId}` deep-link — contract-list picker send. Called once
   *  from the page's ngOnInit. */
  bindDeepLink(): void {
    this.bindQueryParamLink('list', (docId) => void this.onContractListDocId(docId));
  }

  /** `?results={listDocId}_{exitId}` deep link (#1431) — the analysis
   *  page's per-rule send. Contracts emit to the chart with pick-day +
   *  terminal markers per record. Called once from ngOnInit. */
  bindResultsDeepLink(): void {
    this.bindQueryParamLink('results', (docId) => void this.onResultsDocId(docId));
  }

  /** Shared consume-once deep-link pipe — distinctUntilChanged on the
   *  param so unrelated query emissions can't retrigger a load; an
   *  absent param never fires. The param is cleared via replaceUrl —
   *  left in the URL it would re-fire on every refresh; the cleared
   *  emission is a no-op. */
  private bindQueryParamLink(param: string, handler: (id: string) => void): void {
    this.route.queryParamMap
      .pipe(
        map((params) => params.get(param)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((raw) => {
        if (raw == null) return;
        void this.router.navigate([], {
          queryParams: { [param]: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        const id = raw.trim();
        if (id) handler(id);
      });
  }

  /** Result doc → plotted entries → chart. Missing/failed docs name
   *  their error via the page list-error channel; a cross-symbol result
   *  switches the page first (same rule as contract lists). */
  async onResultsDocId(docId: string): Promise<void> {
    const seq = ++this.listDocReqSeq;
    this.listError.set(null);
    let doc: AnalysisResultDoc | null;
    try {
      doc = await firstValueFrom(this.analysisService.getResultDoc$(docId));
    } catch (err) {
      if (seq === this.listDocReqSeq) {
        this.listError.set(
          `Analysis results "${docId}" failed to load: ${(err as Error)?.message ?? 'unknown error'}`,
        );
      }
      return;
    }
    if (seq !== this.listDocReqSeq) return;
    if (!doc) {
      this.listError.set(`Analysis results "${docId}" not found`);
      return;
    }
    if (doc.status !== 'success') {
      this.listError.set(`Analysis results "${docId}" did not complete (status '${doc.status}')`);
      return;
    }
    // Stale registry → refuse to plot silently: record/aggregate shape
    // and hit-rate semantics changed since the doc was written (same
    // gate the results page's 'stale' chip signals).
    if (doc.registryVersion !== EXIT_REGISTRY_VERSION) {
      this.listError.set(
        `Analysis results "${docId}" are stale (registry v${doc.registryVersion} vs current v${EXIT_REGISTRY_VERSION}) — re-run Analyze before charting`,
      );
      return;
    }
    const entries = resultDocToPlottedEntries(doc);
    if (entries.length === 0) {
      this.listError.set(`Analysis results "${docId}" contain no contract records`);
      return;
    }
    this.switchSymbolForDoc(doc.symbol.trim().toUpperCase());
    this.load.emitEntriesToChart(entries);
  }

  /** Cross-symbol docs switch the page first (the swap hook inside
   *  onSymbolChange drops the stale rejection notice). */
  private switchSymbolForDoc(sym: string): void {
    if (sym && sym !== this.page.symbol().trim().toUpperCase()) {
      this.page.onSymbolChange(sym);
    }
  }

  /** `?list=` entry — one read for the symbol check, then the shared
   *  doc tail. Missing/failed docs name their error; the chart is
   *  never touched. A superseded request applies nothing — two quick
   *  `?list=` links resolve out of order, latest wins. */
  async onContractListDocId(docId: string): Promise<void> {
    const seq = ++this.listDocReqSeq;
    this.listError.set(null);
    let doc;
    try {
      doc = await firstValueFrom(this.listService.getList$(docId));
    } catch (err) {
      if (seq === this.listDocReqSeq) {
        this.listError.set(
          `Contract list "${docId}" failed to load: ${(err as Error)?.message ?? 'unknown error'}`,
        );
      }
      return;
    }
    if (seq !== this.listDocReqSeq) return;
    const docErr = contractListDocError(doc, docId);
    if (docErr || !doc) {
      this.listError.set(docErr ?? `Contract list "${docId}" not found`);
      return;
    }
    this.onContractListDoc(doc);
  }

  /** Shared tail — a doc that fails shape validation names its error
   *  without a cross-symbol switch (a failed SPY list must not yank a
   *  QQQ page through a catalog/underlying reload). Then cross-symbol
   *  lists switch the page first, and `loadListDoc` applies the doc
   *  that's already in hand (no second read: `?list=` read once above;
   *  the chooser's row IS the doc). A ready session opens the picker;
   *  a rejected doc names its error. */
  onContractListDoc(doc: OptionsContractListUi): void {
    // Any doc handoff (chooser row, resolved deep link) is the user's
    // latest intent — invalidate a still-in-flight ?list= fetch and
    // clear any stale page error a previous attempt left behind.
    this.listDocReqSeq++;
    this.listError.set(null);
    const docErr = contractListDocError(doc, doc.listId);
    if (docErr) {
      this.listError.set(docErr);
      return;
    }
    this.switchSymbolForDoc(doc.symbol.trim().toUpperCase());
    this.listStore.loadListDoc(doc);
    if (this.listStore.status() === 'ready') {
      this.openListPicker();
    } else if (this.listStore.status() === 'error') {
      this.listError.set(this.listStore.error());
    }
  }

  /** "Lists…" button — recent-doc chooser; the selected row's doc is
   *  already converted, so the same tail loads it with no refetch. */
  openListChooser(): void {
    this.dialog
      .open(ContractListChooserComponent, {
        width: '560px',
        injector: this.injector,
        data: { symbol: this.page.symbol() },
      })
      .afterClosed()
      .subscribe((list?: OptionsContractListUi) => {
        if (list) this.onContractListDoc(list);
      });
  }

  /** Session → picker dialog. Send emits through the `onSend` data
   *  callback then closes (#1419); reopening uses the same session
   *  store, so selection/cursor are preserved. An open picker already
   *  tracks the store — a second open would stack a duplicate dialog. */
  openListPicker(): void {
    if (this.pickerRef) return;
    const ref = this.dialog.open(ContractListPickerComponent, {
      width: '85vw',
      maxWidth: '85vw',
      height: '85vh',
      injector: this.injector,
      data: { onSend: this.emitSessionLines } satisfies ContractListPickerData,
    });
    this.pickerRef = ref;
    ref.afterClosed().subscribe(() => (this.pickerRef = null));
  }
}
