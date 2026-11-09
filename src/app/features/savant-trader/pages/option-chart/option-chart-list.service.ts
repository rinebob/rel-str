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

  /** `?list={docId}` deep-link — distinctUntilChanged on the param so
   *  unrelated query emissions can't retrigger a load (option-chain
   *  pattern); an absent param never fires. The param is consumed once
   *  and cleared — left in the URL it would re-fire the load (and
   *  reopen the picker) on every refresh. replaceUrl keeps the
   *  consumed link out of history; the cleared emission is a no-op.
   *  Called once from the page's ngOnInit. */
  bindDeepLink(): void {
    this.route.queryParamMap
      .pipe(
        map((params) => params.get('list')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((raw) => {
        if (raw == null) return;
        void this.router.navigate([], {
          queryParams: { list: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        const docId = raw.trim();
        if (docId) void this.onContractListDocId(docId);
      });
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
    const sym = doc.symbol.trim().toUpperCase();
    if (sym && sym !== this.page.symbol().trim().toUpperCase()) {
      this.page.onSymbolChange(sym);
    }
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
   *  store, so selection/cursor are preserved. */
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
