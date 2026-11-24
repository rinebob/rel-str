/**
 * @topic #1098 — RH Scanner | @task #1308
 *
 * Scanner chart store — session-scoped bars cache for the recipe table's
 * untracked-row chart popup. Fetches daily OHLCV through
 * `RobinhoodMcpClient.getEquityHistoricals` — the canonical #1259 path
 * for ephemeral charts on untracked symbols — and caches the transformed
 * PriceBars per symbol for the session.
 *
 * Dedupe + settle semantics mirror GalleryCardChartStore: a symbol that
 * is cached, in flight, or carrying a settled error is not refetched —
 * the popup's mount effect re-calls ensureBars on every hover, and a
 * failed symbol must not hammer the API on each re-entry. `clearError`
 * is the escape hatch for the popup's Re-authorize path: it clears the
 * settled slot so the same ensure call retries after reauth.
 */
import { inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withState,
} from '@ngrx/signals';

import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
import { RobinhoodMcpError } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { ToolExecutionErrorCategory } from '@robinhood-mcp/contracts';
import type { PriceBar } from '../../shared/components/flex-chart/flex-chart.types';
import { historicalsToBars } from '../utils/scanner-historicals.util';
import { normScanSymbol } from '../utils/scanner-rows.util';

/** Lookback for the popup chart — ~1 year of daily bars (the popup
 *  window shows ~60; the rest sit in the dataset but stay off-screen —
 *  scrollbar, pan, and wheel-zoom are all disabled). */
export const SCANNER_CHART_LOOKBACK_DAYS = 370;

/** Per-symbol failure record — `auth` marks the RH-session-expired
 *  branch the popup maps to its Re-authorize shell. */
export interface ScannerChartError {
  message: string;
  auth: boolean;
}

interface ScannerChartState {
  bars: Record<string, PriceBar[]>;
  loading: Record<string, boolean>;
  error: Record<string, ScannerChartError | null>;
}

const initialState: ScannerChartState = { bars: {}, loading: {}, error: {} };

const isAuthFailure = (e: unknown): boolean =>
  e instanceof RobinhoodMcpError
    ? e.category === ToolExecutionErrorCategory.AUTH
    : false;

export const ScannerChartStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withMethods(
    (
      state,
      client = inject(RobinhoodMcpClient),
    ) => ({
      /**
       * Ensure a symbol's daily bars are cached — idempotent. In-flight
       * dedupes; settled successes AND settled errors are both terminal
       * for the session (a failing symbol shows its error, not a refetch
       * loop on every popup re-open — clearError is the retry seam).
       */
      ensureBars(symbol: string): void {
        const sym = normScanSymbol(symbol);
        if (!sym) return;
        // error settles terminal — include it in the dedupe guard or every
        // popup re-open retries a failing symbol forever.
        if (
          state.bars()[sym] !== undefined ||
          state.loading()[sym] ||
          state.error()[sym]
        ) {
          return;
        }

        patchState(state, {
          loading: { ...state.loading(), [sym]: true },
          error: { ...state.error(), [sym]: null },
        });

        const start = new Date(
          Date.now() - SCANNER_CHART_LOOKBACK_DAYS * 86_400_000,
        );

        const settle = (err: ScannerChartError | null, bars?: PriceBar[]) =>
          patchState(state, {
            loading: { ...state.loading(), [sym]: false },
            error: { ...state.error(), [sym]: err },
            ...(bars !== undefined
              ? { bars: { ...state.bars(), [sym]: bars } }
              : {}),
          });

        client
          .getEquityHistoricals([sym], 'day', start.toISOString())
          .then((result) => {
            const entry = result.data.results.find((r) => r.symbol === sym);
            if (!entry) {
              // RhChartService.toDataset precedent — a missing entry
              // renders as empty bars; at least leave a trail.
              console.warn(
                `[ScannerChartStore] no result entry for ${sym} — wire returned:`,
                result.data.results.map((r) => r.symbol),
              );
            }
            settle(null, historicalsToBars(entry?.bars));
          })
          .catch((e: unknown) => {
            settle({
              message: e instanceof Error ? e.message : String(e),
              auth: isAuthFailure(e),
            });
          });
      },

      /**
       * Clear a symbol's settled error so a later ensureBars retries —
       * the popup's Re-authorize path calls this before re-ensuring;
       * without it the auth branch could never heal (the slot is
       * terminal by design — dedupe must not double as a dead-end).
       */
      clearError(symbol: string): void {
        const sym = normScanSymbol(symbol);
        if (!sym || state.error()[sym] === undefined) return;
        const next = { ...state.error() };
        delete next[sym];
        patchState(state, { error: next });
      },
    }),
  ),
);
