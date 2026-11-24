/**
 * @topic #1098 — RH Scanner | @task #1307
 *
 * ChartPopupController — the recipe table's `show_chart` overlay
 * lifecycle, extracted so the table stays a dumb renderer. Same role
 * DelegatedCellHover plays for the chain grid (#965): viewport-centered
 * open (#1308 — the chart body overflows button-anchored placement),
 * delayed-close grace for pointer travel, focus guards, and teardown
 * when the reset source re-emits (rows re-emit on recipe switch,
 * filtered-out rows, refresh churn, and the error-status unmount).
 */
import {
  DestroyRef,
  inject,
  linkedSignal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { Overlay, type ConnectedPosition } from '@angular/cdk/overlay';

import type { ScanRow } from '../../utils/scanner-rows.util';
import type { ScannerChartPopupComponent } from './scanner-chart-popup.component';

/** The open popup's row, anchor button, and overlay origin. */
export interface ChartPopupTarget {
  row: ScanRow;
  /** The anchor button — kept for focus restore on close, NOT for
   *  overlay placement (the popup centers on `overlayOrigin`). */
  origin: HTMLElement;
  /** Zero-size point the overlay anchors to — the viewport center,
   *  captured at open so the chart popup lands mid-screen regardless
   *  of where the row's icon sits (#1308 — the chart body is too tall
   *  for button-anchored placement near the viewport's bottom edge).
   *  (CDK's `Point` isn't public — the structural type suffices.) */
  overlayOrigin: { x: number; y: number };
}

export class ChartPopupController {
  /** Selector shared between the leave guard and the panel class
   *  binding — the grace-cancel path detects travel INTO the popup. */
  static readonly PANEL_CLASS = 'scanner-chart-popup-panel';
  readonly panelClass = ChartPopupController.PANEL_CLASS;

  /** Anchor-leave grace before teardown — longer than chain-grid's
   *  250ms (#965): the popup is viewport-centered (#1308), so the
   *  pointer travels farther to reach it. Public so specs advance the
   *  constant. */
  static readonly HIDE_DELAY_MS = 600;

  /** One position — the overlay's center on the origin point's center
   *  (the origin point IS the viewport center, captured at open). No
   *  fallbacks: there is no anchor-relative placement to flip. */
  readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'center', overlayX: 'center', overlayY: 'center' },
  ];

  /** Reposition on scroll — the origin is a fixed viewport point, so
   *  re-application keeps the popup centered (a noop strategy would
   *  behave the same; reposition is harmless and consistent). */
  readonly scrollStrategy = inject(Overlay).scrollStrategies.reposition();

  /** One popup at a time — re-opening for another row swaps it. Resets
   *  whenever the reset source emits so a stale row/origin can't
   *  survive the re-render (the #1306 menu lesson). */
  readonly active: WritableSignal<ChartPopupTarget | null>;

  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  /** close()'s refocus fires focusin on the anchor — suppress the
   *  reopen it would otherwise trigger (#965 review). */
  private suppressFocusOpen = false;

  constructor(
    resetSource: Signal<unknown>,
    private readonly popupCmp: Signal<ScannerChartPopupComponent | undefined>,
  ) {
    this.active = linkedSignal<unknown, ChartPopupTarget | null>({
      source: resetSource,
      computation: () => null,
    });
    inject(DestroyRef).onDestroy(() => this.cancelHide());
  }

  open(row: ScanRow, origin: HTMLElement): void {
    if (this.suppressFocusOpen) return;
    this.cancelHide();
    this.active.set({
      row,
      origin,
      overlayOrigin: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    });
  }

  /** Pointer/focus leaving the anchor — cancel when it landed inside
   *  the popup panel; otherwise the grace starts. */
  onAnchorLeave(to: EventTarget | null): void {
    if (
      to instanceof Element &&
      to.closest(`.${ChartPopupController.PANEL_CLASS}`)
    ) {
      this.cancelHide();
      return;
    }
    this.scheduleHide();
  }

  onPopupEnter(): void {
    this.cancelHide();
  }

  onPopupLeave(): void {
    this.scheduleHide();
  }

  /** Escape (on the anchor or inside the popup) — close now; focus that
   *  was inside returns to the anchor instead of dropping to <body>.
   *  The refocus's focusin is suppressed so it can't reopen the popup
   *  it just closed (#965's suppressFocusOpen). */
  close(): void {
    const refocus = this.popupCmp()?.containsFocus() ?? false;
    const origin = this.active()?.origin;
    this.reset();
    if (refocus) {
      this.suppressFocusOpen = true;
      try {
        origin?.focus();
      } finally {
        this.suppressFocusOpen = false;
      }
    }
  }

  /** Enter/Space on the anchor — the popup is already open via focusin;
   *  move focus inside so keyboard users reach its controls. The native
   *  activation click is canceled so it can't re-open after the focus
   *  move (#965 keyboard path). */
  activate(event?: Event): void {
    event?.preventDefault();
    this.cancelHide();
    requestAnimationFrame(() => this.popupCmp()?.focusPrimary());
  }

  private scheduleHide(): void {
    // Never tear the overlay down under a focused element — focus would
    // drop to <body> and Escape becomes unreachable (#965 review r2).
    // Single choke point: anchor-leave AND popup-leave route through here.
    if (this.popupCmp()?.containsFocus()) return;
    this.cancelHide();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.reset();
    }, ChartPopupController.HIDE_DELAY_MS);
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private reset(): void {
    this.cancelHide();
    this.active.set(null);
  }
}
