/**
 * @topic #746 — On-demand Screenshot Capture (task #768)
 *
 * captureChartSnapshot callable: spec validation → assemble → render →
 * store → result. The onCall wrapper delegates to an exported handler with
 * injected seams (assemble/render/write/now) so the contract is unit-tested
 * without firebase-admin — same pattern as the paper-trading callables.
 *
 * Note: this spec duck-types HttpsError (`err.code`) rather than importing
 * firebase-functions — the root tsconfig cannot resolve it from tests/.
 */
import {
  CaptureEvent,
  ChartInterval,
  MAX_CAPTURE_DIMENSION,
  PositionType,
  type CaptureChartResult,
  type CaptureChartSpec,
} from '@screenshot-capture/contracts';
import {
  SCREENSHOT_STORAGE_PREFIX,
  buildCaptureChartResult,
} from '@screenshot-capture/utils';
import {
  handleCaptureChartSnapshot,
  parseCaptureChartSpec,
  type CaptureChartSnapshotDeps,
  type CaptureChartSnapshotRequest,
} from '../../../functions/src/screenshot-capture/capture-chart';
import {
  InsufficientBarsError,
  assertSufficientBars,
  type AssembledChart,
} from '../../../functions/src/screenshot-capture/chart-data-loader';
import type { ChartRenderModel } from '../../../functions/src/screenshot-capture/render-model';

const NOW = new Date('2026-10-05T14:30:22.000Z');
const SYMBOL = 'GOOG';
const AUTH = { uid: 'test-uid' };
const PNG_STUB = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const VALID_SPEC: CaptureChartSpec = {
  symbol: SYMBOL,
  event: CaptureEvent.ORDER_PLACED,
  positionType: PositionType.STOCK,
};

function model(interval: string): ChartRenderModel {
  return { interval } as unknown as ChartRenderModel;
}

function assembled(): AssembledChart[] {
  return [
    { interval: ChartInterval.DAILY, model: model(ChartInterval.DAILY) },
    { interval: ChartInterval.WEEKLY, model: model(ChartInterval.WEEKLY) },
  ];
}

interface WriteCall {
  path: string;
  body: string | Buffer;
  contentType: string;
}

function makeDeps(overrides: Partial<CaptureChartSnapshotDeps> = {}) {
  const writes: WriteCall[] = [];
  const deps: CaptureChartSnapshotDeps = {
    assembleChartModels: jest.fn(async () => assembled()),
    renderChartSvg: jest.fn((m) => `<svg data-interval="${m.interval}"/>`),
    rasterizeSvgToPng: jest.fn(() => PNG_STUB),
    writeArtifact: jest.fn(async (path: string, body: string | Buffer, contentType: string) => {
      writes.push({ path, body, contentType });
    }),
    now: () => NOW,
    ...overrides,
  };
  return { deps, writes };
}

function req(
  data: unknown,
  auth: { uid: string } | null | undefined = AUTH,
): CaptureChartSnapshotRequest {
  return { data, auth };
}

/** HttpsError's `code` carries the callable error code ('invalid-argument', …). */
function thrownCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code ?? '';
  }
  throw new Error('expected the spec parse to throw');
}

async function expectHttpsCode(promise: Promise<unknown>, code: string): Promise<void> {
  await promise.then(
    () => { throw new Error(`expected rejection with ${code}`); },
    (e) => {
      expect(e).toBeInstanceOf(Error);
      expect((e as { code?: string }).code).toBe(code);
    },
  );
}

describe('parseCaptureChartSpec', () => {
  it('accepts a minimal valid spec', () => {
    const spec = parseCaptureChartSpec(VALID_SPEC);
    expect(spec).toEqual({
      symbol: SYMBOL,
      event: CaptureEvent.ORDER_PLACED,
      positionType: PositionType.STOCK,
    });
  });

  it('uppercases the symbol so doc lookups and paths agree', () => {
    expect(parseCaptureChartSpec({ ...VALID_SPEC, symbol: 'goog' }).symbol).toBe('GOOG');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'GOOG'],
    ['an array', []],
  ])('rejects non-object data: %s', (_label, data) => {
    expect(thrownCode(() => parseCaptureChartSpec(data))).toBe('invalid-argument');
  });

  it.each([
    ['missing', undefined],
    ['non-string', 42],
    ['empty', '   '],
    ['no path-safe chars', '///'],
  ])('rejects symbol %s', (_label, symbol) => {
    expect(
      thrownCode(() => parseCaptureChartSpec({ ...VALID_SPEC, symbol })),
    ).toBe('invalid-argument');
  });

  it.each([
    ['missing', undefined],
    ['unknown value', 'order-cancelled'],
    ['non-string', 7],
  ])('rejects event %s', (_label, event) => {
    expect(
      thrownCode(() => parseCaptureChartSpec({ ...VALID_SPEC, event })),
    ).toBe('invalid-argument');
  });

  it.each([
    ['missing', undefined],
    ['option type reserved for later', 'vertical'],
    ['non-string', 3],
  ])('rejects positionType %s', (_label, positionType) => {
    expect(
      thrownCode(() => parseCaptureChartSpec({ ...VALID_SPEC, positionType })),
    ).toBe('invalid-argument');
  });

  it.each([
    ['non-array', 'daily'],
    ['empty array', []],
    ['unknown member', ['daily', 'minutely']],
    ['monthly (out of scope)', ['monthly']],
  ])('rejects intervals %s', (_label, intervals) => {
    expect(
      thrownCode(() => parseCaptureChartSpec({ ...VALID_SPEC, intervals })),
    ).toBe('invalid-argument');
  });

  it('dedupes repeated intervals', () => {
    const spec = parseCaptureChartSpec({ ...VALID_SPEC, intervals: ['daily', 'daily'] });
    expect(spec.intervals).toEqual(['daily']);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['non-integer', 2.5],
    ['non-"all" string', 'all-caps-ALL'],
    ['non-string junk', {}],
  ])('rejects visibleBars %s', (_label, visibleBars) => {
    expect(
      thrownCode(() => parseCaptureChartSpec({ ...VALID_SPEC, visibleBars })),
    ).toBe('invalid-argument');
  });

  it.each([
    ['zero width', { width: 0 }],
    ['negative height', { height: -100 }],
    ['non-number width', { width: 'wide' }],
    ['width over cap', { width: MAX_CAPTURE_DIMENSION + 1 }],
    ['height over cap', { height: MAX_CAPTURE_DIMENSION + 1 }],
  ])('rejects dimension %s', (_label, patch) => {
    expect(
      thrownCode(() => parseCaptureChartSpec({ ...VALID_SPEC, ...patch })),
    ).toBe('invalid-argument');
  });

  it('rejects non-string refId', () => {
    expect(
      thrownCode(() => parseCaptureChartSpec({ ...VALID_SPEC, refId: 123 })),
    ).toBe('invalid-argument');
  });

  it("accepts visibleBars 'all'", () => {
    const spec = parseCaptureChartSpec({ ...VALID_SPEC, visibleBars: 'all' });
    expect(spec.visibleBars).toBe('all');
  });

  it('drops unknown fields', () => {
    const spec = parseCaptureChartSpec({ ...VALID_SPEC, bogus: 'x' } as any);
    expect('bogus' in spec).toBe(false);
  });
});

describe('assertSufficientBars', () => {
  const bars = {
    [ChartInterval.DAILY]: new Array(40),
    [ChartInterval.WEEKLY]: new Array(40),
  };

  it('passes when every requested interval fills the window', () => {
    expect(() =>
      assertSufficientBars(SYMBOL, [ChartInterval.DAILY, ChartInterval.WEEKLY], 30, bars),
    ).not.toThrow();
  });

  it('defaults to the standard 30-bar window', () => {
    expect(() =>
      assertSufficientBars(SYMBOL, [ChartInterval.DAILY], undefined, bars),
    ).not.toThrow();
    expect(() =>
      assertSufficientBars(SYMBOL, [ChartInterval.DAILY], undefined, {
        ...bars,
        [ChartInterval.DAILY]: new Array(29),
      }),
    ).toThrow(InsufficientBarsError);
  });

  it("requires only one bar for 'all'", () => {
    expect(() =>
      assertSufficientBars(SYMBOL, [ChartInterval.DAILY], 'all', {
        ...bars,
        [ChartInterval.DAILY]: new Array(1),
      }),
    ).not.toThrow();
    expect(() =>
      assertSufficientBars(SYMBOL, [ChartInterval.DAILY], 'all', {
        ...bars,
        [ChartInterval.DAILY]: [],
      }),
    ).toThrow(InsufficientBarsError);
  });

  it('names the failing interval, count, and requirement', () => {
    try {
      assertSufficientBars(SYMBOL, [ChartInterval.WEEKLY], 30, {
        ...bars,
        [ChartInterval.WEEKLY]: new Array(12),
      });
      throw new Error('expected InsufficientBarsError');
    } catch (e) {
      const err = e as InsufficientBarsError;
      expect(err).toBeInstanceOf(InsufficientBarsError);
      expect(err.interval).toBe(ChartInterval.WEEKLY);
      expect(err.available).toBe(12);
      expect(err.required).toBe(30);
    }
  });
});

describe('handleCaptureChartSnapshot', () => {
  it('returns {svg, paths, artifacts} and writes SVG+PNG per interval at the conventional path', async () => {
    const { deps, writes } = makeDeps();
    const result: CaptureChartResult = await handleCaptureChartSnapshot(
      req({ ...VALID_SPEC, refId: 'ord123' }),
      deps,
    );

    expect(deps.assembleChartModels).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: SYMBOL }),
      NOW,
    );
    expect(deps.renderChartSvg).toHaveBeenCalledTimes(2);
    expect(deps.rasterizeSvgToPng).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(4);

    const dailySvg = `${SCREENSHOT_STORAGE_PREFIX}/GOOG/2026-10-05-143022-order-placed-stock-ord123-daily.svg`;
    const dailyPng = `${SCREENSHOT_STORAGE_PREFIX}/GOOG/2026-10-05-143022-order-placed-stock-ord123-daily.png`;
    const weeklySvg = `${SCREENSHOT_STORAGE_PREFIX}/GOOG/2026-10-05-143022-order-placed-stock-ord123-weekly.svg`;
    const weeklyPng = `${SCREENSHOT_STORAGE_PREFIX}/GOOG/2026-10-05-143022-order-placed-stock-ord123-weekly.png`;
    expect(writes.map((w) => w.path)).toEqual([dailySvg, dailyPng, weeklySvg, weeklyPng]);
    expect(writes.filter((w) => w.path.endsWith('.svg'))
      .every((w) => w.contentType === 'image/svg+xml')).toBe(true);
    expect(writes.filter((w) => w.path.endsWith('.png'))
      .every((w) => w.contentType === 'image/png' && Buffer.isBuffer(w.body))).toBe(true);

    expect(result.paths).toEqual([dailySvg, dailyPng, weeklySvg, weeklyPng]);
    expect(result.svg).toBe('<svg data-interval="daily"/>');
    expect(result.artifacts.map((a) => a.interval)).toEqual([
      ChartInterval.DAILY,
      ChartInterval.WEEKLY,
    ]);
    expect(result.artifacts.map((a) => a.pngPath)).toEqual([dailyPng, weeklyPng]);
    // Canonical result shape — equivalent to buildCaptureChartResult output.
    expect(result).toEqual(buildCaptureChartResult(result.artifacts));
  });

  it('writes to identical paths for the same spec at the same timestamp (overwrite-safe retry)', async () => {
    const { deps, writes } = makeDeps();
    await handleCaptureChartSnapshot(req(VALID_SPEC), deps);
    await handleCaptureChartSnapshot(req(VALID_SPEC), deps);
    expect(writes).toHaveLength(8);
    expect(writes[0].path).toBe(writes[4].path);
    expect(writes[1].path).toBe(writes[5].path);
  });

  it('omits the refId segment when not supplied', async () => {
    const { deps } = makeDeps();
    const result = await handleCaptureChartSnapshot(req(VALID_SPEC), deps);
    expect(result.artifacts[0].svgPath).toBe(
      `${SCREENSHOT_STORAGE_PREFIX}/GOOG/2026-10-05-143022-order-placed-stock-daily.svg`,
    );
  });

  it('rejects unauthenticated callers before touching the pipeline', async () => {
    const { deps } = makeDeps();
    await expectHttpsCode(
      handleCaptureChartSnapshot({ data: VALID_SPEC }, deps),
      'unauthenticated',
    );
    await expectHttpsCode(
      handleCaptureChartSnapshot(req(VALID_SPEC, null), deps),
      'unauthenticated',
    );
    expect(deps.assembleChartModels).not.toHaveBeenCalled();
  });

  it('maps insufficient bars to failed-precondition', async () => {
    const { deps } = makeDeps({
      assembleChartModels: jest.fn(async () => {
        throw new InsufficientBarsError(SYMBOL, ChartInterval.WEEKLY, 12, 30);
      }),
    });
    await expectHttpsCode(
      handleCaptureChartSnapshot(req(VALID_SPEC), deps),
      'failed-precondition',
    );
  });

  it('rejects invalid specs with invalid-argument before touching the pipeline', async () => {
    const { deps } = makeDeps();
    await expectHttpsCode(
      handleCaptureChartSnapshot(req({ symbol: SYMBOL }), deps),
      'invalid-argument',
    );
    expect(deps.assembleChartModels).not.toHaveBeenCalled();
    expect(deps.writeArtifact).not.toHaveBeenCalled();
  });

  it.each([
    ['assembly', { assembleChartModels: jest.fn(async () => { throw new Error('firestore down'); }) }],
    ['render', { renderChartSvg: jest.fn(() => { throw new Error('boom'); }) }],
    ['rasterize', { rasterizeSvgToPng: jest.fn(() => { throw new Error('resvg exploded'); }) }],
    ['storage write', { writeArtifact: jest.fn(async () => { throw new Error('bucket denied'); }) }],
  ])('maps %s failure to internal', async (_label, patch) => {
    const { deps } = makeDeps(patch as Partial<CaptureChartSnapshotDeps>);
    await expectHttpsCode(handleCaptureChartSnapshot(req(VALID_SPEC), deps), 'internal');
  });
});
