/**
 * @topic #1098 — RH Scanner | @task #1307
 *
 * ChartPopupController — the recipe table's `show_chart` overlay
 * lifecycle, extracted so the table stays a dumb renderer. Same role
 * DelegatedCellHover plays for the chain grid (#965): anchored open,
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

/** The open popup's row + anchor button. */
export interface ChartPopupTarget {
  row: ScanRow;
  origin: HTMLElement;
}

export class ChartPopupController {
  /** Selector shared between the leave guard and the panel class
   *  binding — the grace-cancel path detects travel INTO the popup. */
  static readonly PANEL_CLASS = 'scanner-chart-popup-panel';
  readonly panelClass = ChartPopupController.PANEL_CLASS;

  /** Anchor-leave grace before teardown — same value chain-grid pins
   *  (POPUP_HIDE_DELAY_MS, #965). Public so specs advance the constant. */
  static readonly HIDE_DELAY_MS = 250;

  /** Right-below the button first, then the flip above, then the
   *  left-side pair — same fallback shape as chain-grid (#965). */
  readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
    { originX: 'start', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

  /** Popup follows its row when the table scrolls — the default noop
   *  strategy would leave it floating over unrelated rows. */
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
    this.active.set({ row, origin });
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
