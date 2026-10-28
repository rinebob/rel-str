/**
 * Shared typed fixtures for latest-run/scan specs (#1232/#1258) —
 * ScanResultRow/ScanLatestRun factories used by the LatestRunStore,
 * viewport, and chart-view page specs.
 */
import type { ScanLatestRun } from '@st/scanner';
import type { ScanResultRow } from '@robinhood-mcp/contracts';

export const scanRow = (ticker: string): ScanResultRow => ({
  ticker,
  instrument_id: `i-${ticker}`,
  instrument_type: 'EQUITY',
  columns: {},
});

export const scanRun = (
  recipeId: string,
  tickers: string[],
  overrides: Partial<Pick<ScanLatestRun, 'ranAt' | 'totalItems' | 'truncated'>> = {},
): ScanLatestRun => ({
  recipeId,
  ranAt: '2026-10-27T14:00:00.000Z',
  totalItems: tickers.length,
  truncated: false,
  rows: tickers.map(scanRow),
  ...overrides,
});
