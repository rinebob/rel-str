/**
 * @topic #1098 — RH Scanner | @task #1307/#1308
 *
 * Scanner chart popup — chrome + chart body for the row `show_chart`
 * action. Rendered inside the recipe table's cdkConnectedOverlay
 * (chain-cell-popup precedent, #965): the table owns the anchor, hover
 * intent, and close grace.
 *
 * One `bodyView` switch drives the body — the tracked fork renders the
 * `state`-input shells until #1309 mounts the gallery card chart; the
 * untracked fork is ScannerChartStore-driven (loading → error/auth →
 * candle chart + SMA overlays). A session-level non-loading `state`
 * input wins over the store so the page's auth gate always shows.
 * Auth failures are session-global (`errorKind: 'auth'` semantics) —
 * the popup emits `reauth` and the page runs the same flow as its
 * banner; untracked rows also clear + retry their own fetch so the
 * affordance actually heals the view.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';

import { BarsInterval } from '../../../../core/models/partner.types';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import {
  ChartIntervalKey,
  type FlexChartConfig,
  type FlexChartDataset,
  type IndicatorConfig,
} from '../../../shared/components/flex-chart/flex-chart.types';
import { ScannerChartStore } from '../../stores/scanner-chart.store';
import { normScanSymbol } from '../../utils/scanner-rows.util';
import {
  smaOverlays,
  volumeColumns,
} from '../../utils/scanner-historicals.util';

/** Fetch-state shells the infra passes via the `state` input. */
export type ScannerChartPopupState = 'loading' | 'error' | 'auth';

/** Body render states — 'chart'/'empty' extend the infra shells once
 *  the untracked store path settles. */
type PopupBodyView = 'loading' | 'error' | 'auth' | 'empty' | 'chart';

const POPUP_SMA_PERIODS = [10, 20, 50] as const;
/** Light-vocabulary hexes — the dark palette's colorRemap lifts each
 *  (#1216 literal-sweep exception: chart colors are chart-lib literals,
 *  not UI theme tokens). */
const POPUP_SMA_COLORS = ['#2196f3', '#ff9800', '#f44336'];
const POPUP_VISIBLE_BARS = 60;

@Component({
  selector: 'app-scanner-chart-popup',
  standalone: true,
  imports: [FlexChartComponent],
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
        @switch (bodyView()) {
          @case ('chart') {
            <div class="popup-chart" data-testid="popup-chart">
              <app-flex-chart
                [chartData]="popupDataset()"
                [config]="popupConfig()"
                height="100%"
              ></app-flex-chart>
            </div>
          }
          @case ('empty') {
            <span class="popup-note">No daily bars for {{ symbol() }}</span>
          }
          @case ('error') {
            <span class="dse-icon popup-err-icon">error_outline</span>
            <span class="popup-note">{{
              storeError() ?? 'Chart unavailable'
            }}</span>
          }
          @case ('auth') {
            <span class="dse-icon popup-err-icon">vpn_key</span>
            <span class="popup-note">
              Robinhood session expired — re-authorize to load charts.
            </span>
            <button type="button" class="ds-btn fill" (click)="onReauth()">
              Re-authorize
            </button>
          }
          @default {
            <span
              class="dse-spinner"
              style="--spinner-size: 18px"
              role="progressbar"
              aria-label="Loading"
            ></span>
            <span class="popup-note">Loading chart…</span>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      .chart-popup {
        pointer-events: auto;
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
        justify-content: center;
        gap: 8px;
        /* Fixed across EVERY body state — the overlay positions once at
         * attach (on the loading shell) and never re-applies on pane
         * growth, so a loading→chart size jump would strand the pane at
         * its stale top-left (F1b follow-up, first-hover clip). */
        width: min(660px, calc(100vw - 32px));
        height: clamp(300px, calc(100vh - 140px), 400px);
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
      .popup-chart {
        width: 100%;
        height: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerChartPopupComponent {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly chartStore = inject(ScannerChartStore);

  readonly symbol = input.required<string>();
  /** Row display name (wire 'Name' column) — blank for most recipes. */
  readonly name = input('');
  /** Tracked-universe membership — selects the body mode (#1308 vs #1309). */
  readonly tracked = input(false);
  /** Fetch-state shell — 'auth' when the session-global RH auth fails.
   *  Drives the tracked fork outright; an explicit non-loading value
   *  also wins over the untracked store state (page auth gate). */
  readonly state = input<ScannerChartPopupState>('loading');

  /** Auth branch click → the page's reauth flow (same as its banner). */
  readonly reauth = output<void>();
  /** Header deep-link — the peek stays transient; drilling into the
   *  symbol is a navigation to chart-view, not a pinned popup. */
  readonly openChart = output<void>();

  /** Cache-key symbol — the store and scanner rows share one
   *  normalization policy. */
  private readonly sym = computed(() => normScanSymbol(this.symbol()));

  constructor() {
    // Untracked rows fetch on mount — ensureBars dedupes in-flight work
    // and treats settled errors as terminal, so popup re-opens are free.
    effect(() => {
      if (!this.tracked()) this.chartStore.ensureBars(this.sym());
    });
  }

  /** One switch for both forks: tracked rows read the `state` input
   *  outright (infra shells until #1309); untracked rows let an
   *  explicit non-loading input win, then the store's settled slots. */
  readonly bodyView = computed<PopupBodyView>(() => {
    const s = this.state();
    if (this.tracked()) return s;
    if (s !== 'loading') return s;
    const err = this.chartStore.error()[this.sym()];
    if (err) return err.auth ? 'auth' : 'error';
    const bars = this.chartStore.bars()[this.sym()];
    if (bars === undefined) return 'loading';
    return bars.length > 0 ? 'chart' : 'empty';
  });

  readonly storeError = computed(
    () => this.chartStore.error()[this.sym()]?.message ?? null,
  );

  readonly popupDataset = computed<FlexChartDataset>(() => ({
    symbol: this.sym(),
    interval: BarsInterval.DAILY,
    bars: this.chartStore.bars()[this.sym()] ?? [],
  }));

  /** Candle + three SMA lines over the price pane, volume columns in a
   *  lower pane — no toolbar, dots, scrollbar, or crosshair; the palette
   *  resolves candle fills. The volume indicator is omitted entirely when
   *  no bar carries volume so the lower pane collapses back to 0%. */
  readonly popupConfig = computed<FlexChartConfig>(() => {
    const bars = this.chartStore.bars()[this.sym()] ?? [];
    const vol = volumeColumns(bars);
    return {
      indicators: [
        ...smaOverlays(bars, POPUP_SMA_PERIODS).map(
          (o, i): IndicatorConfig => ({
            id: `sma-${o.period}`,
            type: 'custom',
            pane: 'overlay',
            seriesType: 'line',
            params: { period: o.period },
            options: {
              name: `SMA ${o.period}`,
              color: POPUP_SMA_COLORS[i],
              lineWidth: 1.5,
              axisScale: 'price',
            },
            data: o.points.flatMap((p) =>
              p.y === null ? [] : [{ x: p.x, y: p.y }],
            ),
          }),
        ),
        ...(vol.length > 0
          ? [
              // 'volume' has no registered calculator — precomputed
              // config.data renders via the generic column block
              // (per-point color → up/down to match the candles).
              {
                id: 'volume',
                type: 'volume',
                pane: 'lower-1',
                seriesType: 'column',
                params: {},
                options: { name: 'Vol M' },
                data: vol,
              } satisfies IndicatorConfig,
            ]
          : []),
      ],
      interval: ChartIntervalKey.DAILY,
      visibleBars: POPUP_VISIBLE_BARS,
      mainPanePercent: 75,
      showCrosshair: false,
      showZoomToolbar: false,
      enableScrollbar: false,
    };
  });

  /** Re-authorize click — emit for the page flow AND clear+retry this
   *  symbol so the settled auth slot can't strand the view. A retry
   *  that lands before reauth completes just settles 'auth' again —
   *  self-correcting, never stuck. */
  onReauth(): void {
    if (!this.tracked()) {
      this.chartStore.clearError(this.sym());
      this.chartStore.ensureBars(this.sym());
    }
    this.reauth.emit();
  }

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
