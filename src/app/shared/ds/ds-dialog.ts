/**
 * ds-dialog — de-materified replacement for DsDialogService (#1163 phase B).
 *
 * Same API shape: `open(ComponentType, { data }).afterClosed()` inside the
 * opened component `inject(DsDialogRef)` / `inject(DS_DIALOG_DATA)`.
 * The overlay panel carries `.dse-dialog` (global mixin emission); dialog
 * templates use `.title` / `.content` / `.actions` children instead of
 * `mat-dialog-*` elements, and `(click)="ref.close(result)"` instead of
 * `matDialogClose`.
 */
import {
  inject,
  Injectable,
  InjectionToken,
  Injector,
} from '@angular/core';
import { ComponentPortal, ComponentType } from '@angular/cdk/portal';
import { Overlay, OverlayConfig, OverlayRef } from '@angular/cdk/overlay';
import { FocusTrapFactory } from '@angular/cdk/a11y';
import { Observable, Subject } from 'rxjs';

/** Injection token carrying `data` into the opened dialog component —
 *  the de-materified analogue of `DS_DIALOG_DATA`. */
export const DS_DIALOG_DATA = new InjectionToken<any>('DsDialogData');

/** Handle to an open ds-dialog — the analogue of `MatDialogRef`. */
export class DsDialogRef<C = unknown, R = any> {
  private readonly closed$ = new Subject<R | undefined>();
  private finished = false;
  /** Mirrors MatDialogRef.disableClose — when true, backdrop/Escape do not close. */
  disableClose?: boolean;

  constructor(private readonly overlayRef: OverlayRef) {}

  /** Close the dialog, resolving `afterClosed` with `result`. */
  close(result?: R): void {
    if (this.finished) return;
    this.finished = true;
    this.overlayRef.dispose();
    this.closed$.next(result);
    this.closed$.complete();
  }

  /** Emits once when the dialog closes — undefined on backdrop/Escape. */
  afterClosed(): Observable<R | undefined> {
    return this.closed$.asObservable();
  }

  /** Mirrors MatDialogRef.updateSize — restyles the overlay pane. */
  updateSize(width?: string, height?: string): void {
    this.overlayRef.updateSize({ width, height });
  }
}

/** Options accepted by {@link DsDialogService.open} — the subset of
 *  MatDialogConfig the app actually uses. */
export interface DsDialogConfig<D = unknown> {
  /** Data injected via {@link DS_DIALOG_DATA}. */
  data?: D;
  /** Optional pane width — defaults to the .dse-dialog contract (280–480px). */
  width?: string;
  /** Optional pane height. */
  height?: string;
  /** Optional pane max-width override. */
  maxWidth?: string;
  /** Optional pane max-height override. */
  maxHeight?: string;
  /** When true, skip focusing the initial element on open. */
  autoFocus?: boolean;
  /** When true, backdrop click and Escape do not close the dialog. */
  disableClose?: boolean;
  /** Extra pane classes appended to the default `.dse-dialog` panel. */
  panelClass?: string | string[];
  /** Element injector for the dialog component — required when the dialog
   *  resolves page-scoped providers (DsDialogService's `injector` option). */
  injector?: Injector;
  /** DsDialogService's `viewContainerRef` — honored via its injector so dialogs
   *  resolving view-scoped providers still resolve. */
  viewContainerRef?: { injector: Injector };
}

@Injectable({ providedIn: 'root' })
export class DsDialogService {
  private readonly overlay = inject(Overlay);
  private readonly rootInjector = inject(Injector);
  private readonly focusTrapFactory = inject(FocusTrapFactory);

  /** Currently-open dialog refs — mirrors `MatDialog.openDialogs`. */
  get openDialogs(): readonly DsDialogRef<any, any>[] {
    return this._openDialogs;
  }
  private readonly _openDialogs: DsDialogRef<any, any>[] = [];

  /** Open `component` centered over a backdrop. Mirrors `MatDialog.open`. */
  open<C, D = any, R = any>(
    component: ComponentType<C>,
    config: DsDialogConfig<D> = {},
  ): DsDialogRef<C, R> {
    const overlayRef = this.overlay.create(
      new OverlayConfig({
        positionStrategy: this.overlay
          .position()
          .global()
          .centerHorizontally()
          .centerVertically(),
        scrollStrategy: this.overlay.scrollStrategies.block(),
        hasBackdrop: true,
        backdropClass: 'cdk-overlay-dark-backdrop',
        panelClass: ['dse-dialog', ...(config.panelClass ?? [])].flat(),
        width: config.width,
        height: config.height,
        maxWidth: config.maxWidth ?? '90vw',
        maxHeight: config.maxHeight,
      }),
    );

    const ref = new DsDialogRef<C, R>(overlayRef);
    ref.disableClose = config.disableClose;
    this._openDialogs.push(ref);
    ref.afterClosed().subscribe(() => {
      const i = this._openDialogs.indexOf(ref);
      if (i >= 0) this._openDialogs.splice(i, 1);
    });
    overlayRef.backdropClick().subscribe(() => {
      if (!ref.disableClose) ref.close();
    });
    overlayRef
      .keydownEvents()
      .subscribe((e) => e.key === 'Escape' && !ref.disableClose && ref.close());

    const injector = Injector.create({
      providers: [
        { provide: DsDialogRef, useValue: ref },
        { provide: DS_DIALOG_DATA, useValue: config.data }],
      parent:
        config.injector ?? config.viewContainerRef?.injector ?? this.rootInjector,
    });
    const portal = new ComponentPortal(component, null, injector);
    overlayRef.attach(portal);

    // Focus trap — keep tab order inside the dialog while it is open.
    const focusTrap = this.focusTrapFactory.create(overlayRef.overlayElement);
    const previousFocus = document.activeElement as HTMLElement | null;
    if (config.autoFocus !== false) {
      focusTrap.focusInitialElementWhenReady();
    }
    overlayRef.detachments().subscribe(() => {
      focusTrap.destroy();
      previousFocus?.focus?.();
    });

    return ref;
  }

  /** Closes every open dialog — mirrors `MatDialog.closeAll`. */
  closeAll(): void {
    for (const ref of [...this._openDialogs]) ref.close();
  }
}
