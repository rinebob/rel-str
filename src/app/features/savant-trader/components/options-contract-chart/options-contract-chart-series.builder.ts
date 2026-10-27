/**
 * Pure builders for OptionsContractChartComponent's Syncfusion series
 * collection — one mark line per plotted contract, per-contract strike-span
 * markers, the underlying overlay, and the single-contract lower panes.
 * Extracted so series construction stays pure/testable and the component
 * remains signal wiring + event handlers.
 */
import type { ParsedObservation } from '../../utils/contract-observation.utils';
import { unionLabels, MULTI_SERIES_PALETTE } from '../../utils/chart-series.utils';

/** Series name prefix for strike-span markers — hidden from the legend. */
export const MARKER_NAME_PREFIX = '__span__';

/** One contract's data as chart input — metadata drives the span marker,
 *  points are the (already display-window clipped) mark series. */
export interface PlottedChartContract {
  contractId: string;
  label: string;
  strike: number;
  expiration: string;
  openDate: string | null;
  points: ParsedObservation[];
}

export interface ChartPoint {
  date: string;
  value: number | null;
}

export interface SpanMarker {
  contractId: string;
  index: number;
  start: string;
  end: string;
  strike: number;
}

/** What a series is for — lets specs/tooling identify series without
 *  parsing display names. */
export type ChartSeriesRole = 'mark' | 'marker' | 'underlying' | 'pane';

/** The series config objects handed to ejs-chart's [series] input — the
 *  fields this chart actually sets (Syncfusion accepts the superset). */
export interface ChartSeriesSpec {
  role: ChartSeriesRole;
  type: 'Line' | 'Column';
  name: string;
  dataSource: unknown[];
  xName: string;
  yName: string;
  yAxisName?: string;
  width?: number;
  dashArray?: string;
  fill?: string;
  marker?: { visible: boolean; shape?: string; width?: number; height?: number; fill?: string };
  animation?: { enable: boolean };
  enableTooltip?: boolean;
  emptyPointSettings?: { mode: string };
}

// Colors — index 0 keeps the original single-contract mark blue; the rest
// follow the shared multi-series palette so each contract's mark line and
// span marker stay color-matched.
export const MARK_COLOR = '#1976d2';
export const UNDERLYING_COLOR = '#ff9800';
export const IV_COLOR = '#9c27b0';
export const DELTA_COLOR = '#00bcd4';
export const GAMMA_COLOR = '#ff5722';
export const VOLUME_COLOR = '#42a5f5';
export const OI_COLOR = '#66bb6a';

// Plotted-contract colors: shared multi-series palette with index 0
// overridden by the original single-contract mark blue so each contract's
// mark line and span marker stay color-matched.
const PLOTTED_COLORS = [MARK_COLOR, ...MULTI_SERIES_PALETTE.slice(1)];

const plottedColor = (index: number): string =>
  PLOTTED_COLORS[index % PLOTTED_COLORS.length];

const NO_MARKER = { visible: false };
const NO_ANIMATION = { enable: false };
const GAPS = { mode: 'Gap' };

/** Strike-span markers: openDate → expiration at the contract's strike.
 *  The left dot marks the day the contract was selected — never the start
 *  of its trading history — so a contract with no entry date gets no
 *  marker, and a reversed span (openDate > expiration) is skipped. */
export function computeMarkerSpans(contracts: readonly PlottedChartContract[]): SpanMarker[] {
  return contracts
    .map((c, index): SpanMarker | null => {
      const start = c.openDate;
      if (!start || !c.expiration || start > c.expiration) return null;
      return { contractId: c.contractId, index, start, end: c.expiration, strike: c.strike };
    })
    .filter((s): s is SpanMarker => s != null);
}

/** The labels the category axis must carry — rendered dates plus every
 *  marker endpoint, so span markers always land on a category even when
 *  their dates aren't observation dates. The chart owns this invariant;
 *  callers only supply the rendered-date labels. */
export function unionAxisLabels(labels: readonly string[], spans: readonly SpanMarker[]): string[] {
  const endpoints = spans.flatMap((s) => [s.start, s.end]);
  return unionLabels(labels, endpoints);
}

export interface SeriesBuildInput {
  contracts: readonly PlottedChartContract[];
  alignedMarks: ChartPoint[][];
  underlying: ChartPoint[];
  markers: SpanMarker[];
  showUnderlying: boolean;
  showGreeks: boolean;
  showVolumeOI: boolean;
}

/** Full series collection — mark lines first so the category axis is
 *  established from the sorted union before markers/overlay/lower panes. */
export function buildSeriesCollection(input: SeriesBuildInput): ChartSeriesSpec[] {
  const series: ChartSeriesSpec[] = [];

  input.contracts.forEach((c, i) => {
    series.push({
      role: 'mark',
      type: 'Line',
      name: c.label,
      dataSource: input.alignedMarks[i],
      xName: 'date',
      yName: 'value',
      width: 2,
      fill: plottedColor(i),
      marker: NO_MARKER,
      animation: NO_ANIMATION,
      emptyPointSettings: GAPS,
    });
  });

  for (const span of input.markers) {
    const color = plottedColor(span.index);
    series.push({
      role: 'marker',
      type: 'Line',
      name: `${MARKER_NAME_PREFIX}${span.contractId}`,
      dataSource: [
        { date: span.start, value: span.strike },
        { date: span.end, value: span.strike },
      ],
      xName: 'date',
      yName: 'value',
      yAxisName: 'underlyingAxis',
      width: 1.5,
      dashArray: '3,3',
      fill: color,
      marker: { visible: true, shape: 'Circle', width: 8, height: 8, fill: color },
      animation: NO_ANIMATION,
      enableTooltip: false,
    });
  }

  if (input.showUnderlying && input.underlying.length > 0) {
    series.push({
      role: 'underlying',
      type: 'Line',
      name: 'Underlying',
      // Drop, not Gap: points stay aligned to their true categories but the
      // line connects across dates the underlying has no bar for — the
      // overlay reads as a continuous series, not the mark lines' gap policy.
      dataSource: input.underlying,
      xName: 'date',
      yName: 'value',
      yAxisName: 'underlyingAxis',
      width: 1.5,
      dashArray: '5,3',
      fill: UNDERLYING_COLOR,
      marker: NO_MARKER,
      animation: NO_ANIMATION,
      emptyPointSettings: { mode: 'Drop' },
    });
  }

  // Lower panes only exist for the single-contract view.
  const single = input.contracts.length === 1 ? input.contracts[0].points : [];
  if (single.length > 0) {
    const pane = (partial: Partial<ChartSeriesSpec> & Pick<ChartSeriesSpec, 'name' | 'yName' | 'yAxisName' | 'type'>): ChartSeriesSpec => ({
      role: 'pane',
      dataSource: single,
      xName: 'date',
      animation: NO_ANIMATION,
      ...partial,
    });
    series.push(
      pane({ type: 'Line', name: 'IV', yName: 'iv', yAxisName: 'ivAxis', width: 1.5, fill: IV_COLOR, marker: NO_MARKER }),
    );
    if (input.showGreeks) {
      series.push(
        pane({ type: 'Line', name: 'Delta', yName: 'delta', yAxisName: 'greeksAxis', width: 1.5, fill: DELTA_COLOR, marker: NO_MARKER }),
        pane({ type: 'Line', name: 'Gamma', yName: 'gamma', yAxisName: 'gammaAxis', width: 1.5, fill: GAMMA_COLOR, marker: NO_MARKER }),
      );
    }
    if (input.showVolumeOI) {
      series.push(
        pane({ type: 'Column', name: 'Volume', yName: 'volume', yAxisName: 'volumeAxis', fill: VOLUME_COLOR }),
        pane({ type: 'Line', name: 'OI', yName: 'openInterest', yAxisName: 'oiAxis', fill: OI_COLOR, marker: NO_MARKER }),
      );
    }
  }

  return series;
}

/** Static axis configs for the single-contract lower panes — the chart
 *  appends them to the underlying axis only when the panes are shown. */
export const LOWER_PANE_AXES: Record<string, unknown>[] = [
  {
    name: 'ivAxis',
    labelFormat: '{value}',
    lineStyle: { color: '#e0e0e0' },
    majorTickLines: { width: 0 },
    labelStyle: { size: '10px' },
    rangePadding: 'None',
    rowIndex: 2, // second pane: IV
  },
  {
    name: 'greeksAxis',
    labelFormat: '{value}',
    lineStyle: { color: '#e0e0e0' },
    majorTickLines: { width: 0 },
    labelStyle: { size: '10px' },
    rangePadding: 'None',
    rowIndex: 1, // third pane: Greeks (Delta)
  },
  {
    name: 'gammaAxis',
    opposedPosition: true,
    labelFormat: '{value}',
    lineStyle: { color: '#ff5722', width: 1 },
    majorTickLines: { width: 0 },
    labelStyle: { size: '10px', color: '#ff5722' },
    rangePadding: 'None',
    rowIndex: 1, // third pane: Greeks (Gamma)
  },
  {
    name: 'volumeAxis',
    labelFormat: '{value}',
    lineStyle: { color: '#e0e0e0' },
    majorTickLines: { width: 0 },
    labelStyle: { size: '10px' },
    rangePadding: 'None',
    rowIndex: 0, // bottom pane: Volume/OI
  },
  {
    name: 'oiAxis',
    opposedPosition: true,
    labelFormat: '{value}',
    lineStyle: { color: '#66bb6a', width: 1 },
    majorTickLines: { width: 0 },
    labelStyle: { size: '10px', color: '#66bb6a' },
    rangePadding: 'None',
    rowIndex: 0, // bottom pane: Volume/OI (opposed)
  },
];
