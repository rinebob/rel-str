/**
 * captureChartSnapshot — callable entry to the screenshot-capture pipeline
 * (task #768). Thin orchestration only: parse/validate the spec → assemble
 * one render model per interval → render SVG → write artifacts to the
 * default bucket → return the contract result.
 *
 * The exported `handleCaptureChartSnapshot` takes injected seams (paper-
 * trading callable pattern) so the whole contract — including error-code
 * mapping — is unit-testable without firebase-admin.
 *
 * Error contract (per IMPL): invalid spec fields → `invalid-argument`;
 * insufficient bars for the requested window → `failed-precondition`;
 * anything else → `internal`, logged with the spec.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { getStorage } from 'firebase-admin/storage';

// Side-effect import: initializes the default app for getStorage().
import '../firebase-admin-init';

import {
  CaptureEvent,
  ChartInterval,
  MAX_CAPTURE_DIMENSION,
  PositionType,
  VISIBLE_BARS_ALL,
  type CaptureArtifact,
  type CaptureChartResult,
  type CaptureChartSpec,
  type CaptureInterval,
  type VisibleBars,
} from '@screenshot-capture/contracts';
import {
  buildCaptureChartResult,
  buildScreenshotStoragePath,
  symbolPathSegment,
} from '@screenshot-capture/utils';
import { ST_ALLOWED_ORIGINS } from '../st-cloud-function/cors';
import {
  InsufficientBarsError,
  assembleChartModels,
  type AssembledChart,
} from './chart-data-loader';
import type { ChartRenderModel } from './render-model';
import { renderChartSvg } from './svg-renderer';
import { createArtifactWriter, type ArtifactWriter } from './storage-writer';

const SVG_CONTENT_TYPE = 'image/svg+xml';

// ── Spec validation ─────────────────────────────────────────────────────────

const CAPTURE_EVENTS = new Set<string>(Object.values(CaptureEvent));
const CAPTURE_INTERVALS = new Set<string>([ChartInterval.DAILY, ChartInterval.WEEKLY]);

const fail = (message: string): never => {
  throw new HttpsError('invalid-argument', message);
};

/**
 * Raw request data → validated spec. Unknown fields are dropped so nothing
 * unvalidated flows into the pipeline.
 */
export function parseCaptureChartSpec(data: unknown): CaptureChartSpec {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail('captureChartSnapshot requires a spec object');
  }
  const d = data as Record<string, unknown>;

  // Uppercased once — symbol-data doc ids and storage paths both key on the
  // canonical form, so 'goog' resolves the same as 'GOOG'.
  const symbol = typeof d.symbol === 'string' ? d.symbol.trim().toUpperCase() : '';
  if (!symbol) fail('symbol is required');
  if (!symbolPathSegment(symbol)) {
    fail(`symbol ${JSON.stringify(symbol)} has no path-safe characters`);
  }

  const event = d.event;
  if (typeof event !== 'string' || !CAPTURE_EVENTS.has(event)) {
    fail(`event must be one of: ${[...CAPTURE_EVENTS].join(', ')}`);
  }
  if (d.positionType !== PositionType.STOCK) {
    fail(`positionType '${PositionType.STOCK}' is the only supported value`);
  }

  let intervals: CaptureInterval[] | undefined;
  const intervalList = Array.isArray(d.intervals) ? d.intervals : undefined;
  if (d.intervals !== undefined) {
    if (
      !intervalList || intervalList.length === 0 ||
      !intervalList.every((i) => typeof i === 'string' && CAPTURE_INTERVALS.has(i))
    ) {
      fail(`intervals must be a non-empty array of '${ChartInterval.DAILY}' | '${ChartInterval.WEEKLY}'`);
    }
    intervals = [...new Set(intervalList)] as CaptureInterval[];
  }

  let visibleBars: VisibleBars | undefined;
  if (d.visibleBars !== undefined) {
    const v = d.visibleBars;
    if (v !== VISIBLE_BARS_ALL && (typeof v !== 'number' || !Number.isInteger(v) || v < 1)) {
      fail(`visibleBars must be a positive integer or '${VISIBLE_BARS_ALL}'`);
    }
    visibleBars = v as VisibleBars;
  }

  const dimension = (name: 'width' | 'height'): number | undefined => {
    const v = d[name];
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_CAPTURE_DIMENSION) {
      throw new HttpsError('invalid-argument', `${name} must be a positive number ≤ ${MAX_CAPTURE_DIMENSION}`);
    }
    return v;
  };
  const width = dimension('width');
  const height = dimension('height');

  if (d.refId !== undefined && typeof d.refId !== 'string') fail('refId must be a string');

  return {
    symbol,
    event: d.event as CaptureEvent,
    positionType: PositionType.STOCK,
    ...(intervals ? { intervals } : {}),
    ...(d.refId !== undefined ? { refId: d.refId as string } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(visibleBars !== undefined ? { visibleBars } : {}),
  };
}

// ── Orchestration ───────────────────────────────────────────────────────────

/** Injectable seams — production wiring lives in `captureChartSnapshot`;
 *  tests substitute fakes (no firebase-admin needed for the contract). */
export interface CaptureChartSnapshotDeps {
  assembleChartModels: (spec: CaptureChartSpec, now: Date) => Promise<AssembledChart[]>;
  renderChartSvg: (model: ChartRenderModel) => string;
  writeArtifact: ArtifactWriter;
  now: () => Date;
}

/** One timestamp for the whole capture — every interval's path shares the
 *  same date+time segments. */
function captureTimestamp(now: Date): { date: string; time: string } {
  const iso = now.toISOString(); // yyyy-mm-ddTHH:mm:ss.sssZ
  return { date: iso.slice(0, 10), time: iso.slice(11, 19).replaceAll(':', '') };
}

/** CallableRequest minus the fields the handler doesn't need — keeps the
 *  seam a plain object so tests don't construct a full CallableRequest. */
export interface CaptureChartSnapshotRequest {
  data: unknown;
  auth?: { uid: string } | null;
}

export async function handleCaptureChartSnapshot(
  request: CaptureChartSnapshotRequest,
  deps: CaptureChartSnapshotDeps,
): Promise<CaptureChartResult> {
  let spec: CaptureChartSpec | undefined;
  try {
    // Write side-effect callable — same auth bar as the paper-trading
    // callables (the dev-page caller is already auth-guarded).
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Must be signed in to capture a chart snapshot');
    }
    spec = parseCaptureChartSpec(request.data);
    const now = deps.now();
    const { date, time } = captureTimestamp(now);

    const charts = await deps.assembleChartModels(spec, now);

    // Destructured so the async map closes over consts, not the hoisted let.
    const { symbol, event, positionType, refId } = spec;
    const artifacts: CaptureArtifact[] = await Promise.all(
      charts.map(async (chart) => {
        const svg = deps.renderChartSvg(chart.model);
        const svgPath = buildScreenshotStoragePath({
          symbol,
          event,
          positionType,
          interval: chart.interval,
          ext: 'svg',
          date,
          time,
          refId,
        });
        await deps.writeArtifact(svgPath, svg, SVG_CONTENT_TYPE);
        return { interval: chart.interval, svg, svgPath };
      }),
    );

    const result = buildCaptureChartResult(artifacts);
    logger.info('capture_chart_snapshot', { symbol, paths: result.paths });
    return result;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err instanceof InsufficientBarsError) {
      throw new HttpsError('failed-precondition', err.message);
    }
    logger.error('capture_chart_snapshot_error', {
      symbol: spec?.symbol,
      spec,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw new HttpsError('internal', err instanceof Error ? err.message : 'capture failed');
  }
}

export const captureChartSnapshot = onCall<unknown, Promise<CaptureChartResult>>(
  { cors: ST_ALLOWED_ORIGINS, memory: '256MiB', timeoutSeconds: 60 },
  async (request) =>
    handleCaptureChartSnapshot(request, {
      assembleChartModels,
      renderChartSvg,
      writeArtifact: createArtifactWriter(getStorage().bucket()),
      now: () => new Date(),
    }),
);
