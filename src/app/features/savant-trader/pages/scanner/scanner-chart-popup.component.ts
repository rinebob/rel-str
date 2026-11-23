/**
 * @topic #1098 — RH Scanner | @task #1307
 *
 * Scanner chart popup — chrome + fetch-state shells for the row
 * `show_chart` action. Rendered inside the recipe table's
 * cdkConnectedOverlay (chain-cell-popup precedent, #965): the table owns
 * the anchor, hover intent, and close grace.
 *
 * The body carries the tracked-mode fork (`data-mode`) the chart tasks
 * fill — #1308 mounts the untracked candle chart, #1309 the gallery card
 * chart — over the same state shells: loading spinner, error text, and
 * the auth branch's reauth affordance. Auth failures are session-global
 * (`errorKind: 'auth'` semantics) — the popup emits `reauth` and the page
 * runs the same flow as its banner.
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';

/** Fetch-state shells the body renders while the chart tasks land. */
export type ScannerChartPopupState = 'loading' | 'error' | 'auth';

@Component({
  selector: 'app-scanner-chart-popup',
  standalone: true,
  imports: [],
  template: `
    <div
      class="chart-popup"
      data-testid="chart-popup"
      role="dialog"
      [attr.aria-label]="'Chart: ' + symbol()"
    >
      <div class="popup-head">
        <span class="popup-symbol">{{ symbol() }}</span>
        @if (name(); as n) {
          <span class="popup-name">{{ n }}</span>
        }
        <button
          type="button"
          class="popup-open-btn"
          data-testid="open-chart-btn"
          title="Open full chart"
          aria-label="Open full chart"
          (click)="openChart.emit()"
        >
          <span class="dse-icon" aria-hidden="true">open_in_new</span>
        </button>
      </div>
      <div
        class="popup-body"
        [attr.data-mode]="tracked() ? 'tracked' : 'untracked'"
      >
        @switch (state()) {
          @case ('loading') {
            <span
              class="dse-spinner"
              style="--spinner-size: 18px"
              role="progressbar"
              aria-label="Loading"
            ></span>
            <span class="popup-note">Loading chart…</span>
          }
          @case ('error') {
            <span class="dse-icon popup-err-icon">error_outline</span>
            <span class="popup-note">{{ error() ?? 'Chart unavailable' }}</span>
          }
          @case ('auth') {
            <span class="dse-icon popup-err-icon">vpn_key</span>
            <span class="popup-note">
              Robinhood session expired — re-authorize to load charts.
            </span>
            <button type="button" class="ds-btn fill" (click)="reauth.emit()">
              Re-authorize
            </button>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      .chart-popup {
        pointer-events: auto;
        min-width: 240px;
        padding: 8px 10px;
        background: var(--ds-surface-overlay);
        color: var(--ds-on-surface);
        border-radius: 4px;
        box-shadow: var(--ds-shadow-2);
        font-size: 0.68rem;
        line-height: 1.3;
      }
      .popup-head {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 6px;
      }
      .popup-symbol {
        font-weight: 700;
        font-size: 0.72rem;
        letter-spacing: 0.02em;
      }
      .popup-name {
        opacity: 0.65;
        font-size: 0.62rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 220px;
      }
      .popup-open-btn {
        margin-left: auto;
        align-self: center;
        border: 0;
        background: transparent;
        color: inherit;
        opacity: 0.7;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
      }
      .popup-open-btn:hover {
        opacity: 1;
      }
      .popup-open-btn .dse-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
      .popup-body {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
      }
      .popup-note {
        opacity: 0.8;
      }
      .popup-err-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--mat-sys-error, var(--ds-down));
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerChartPopupComponent {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly symbol = input.required<string>();
  /** Row display name (wire 'Name' column) — blank for most recipes. */
  readonly name = input('');
  /** Tracked-universe membership — selects the body mode (#1308 vs #1309). */
  readonly tracked = input(false);
  /** Fetch-state shell — 'auth' when the session-global RH auth fails. */
  readonly state = input<ScannerChartPopupState>('loading');
  readonly error = input<string | null>(null);

  /** Auth branch click → the page's reauth flow (same as its banner). */
  readonly reauth = output<void>();
  /** Header deep-link — the peek stays transient; drilling into the
   *  symbol is a navigation to chart-view, not a pinned popup. */
  readonly openChart = output<void>();

  /** True while a descendant holds focus — the table must not tear the
   *  overlay down under a focused control (the auth branch's button). */
  containsFocus(): boolean {
    return this.el.nativeElement.contains(document.activeElement);
  }

  /** Move keyboard focus into the popup — the table calls this on
   *  Enter/Space at the anchor button (#965 keyboard path). A no-op in
   *  states without a focusable control. */
  focusPrimary(): void {
    // Body-scoped — the header deep-link is secondary chrome; Enter/Space
    // at the anchor lands on the body's affordance (auth: Re-authorize).
    this.el.nativeElement
      .querySelector<HTMLElement>('.popup-body button')
      ?.focus();
  }
}
