/**
 * @topic #746 — On-demand Screenshot Capture (task #845)
 *
 * captureLifecycleEvent — the order-lifecycle intake: transactional dedup
 * claim on the carrier doc's `capturedEvents` map → await-capped capture
 * (renderOnly:false) → manifest commit + st-screenshots index doc. The
 * Firestore seam is a `transact` work-callback with map-backed reads/writes,
 * same shape as the paper-trading ledger deps.
 */
import {
  CaptureEvent,
  PositionType,
  type CaptureChartResult,
  type CaptureChartSpec,
} from '@screenshot-capture/contracts';
import {
  CAPTURED_EVENTS_FIELD,
  LIFECYCLE_CAPTURE_TIMEOUT_MS,
  captureLifecycleEvent,
  screenshotIndexDocId,
  type CapturedEventEntry,
  type LifecycleCaptureDeps,
  type LifecycleCaptureInput,
  type LifecycleTxn,
} from '../../../functions/src/screenshot-capture/lifecycle-capture';

const NOW = new Date('2026-10-05T14:30:22.000Z');
const INTENT_DOC = 'savant-trader/data/order-intents/intent-1';
const POSITION_DOC = 'paper-trading/positions/items/pos-1';

const CAPTURED: CaptureChartResult = {
  svg: '<svg/>',
  paths: ['st-trade-screenshots/GOOG/cohort-9/a.svg', 'st-trade-screenshots/GOOG/cohort-9/a.png'],
  artifacts: [],
};

const BASE_INPUT: LifecycleCaptureInput = {
  positionId: 'pos-1',
  groupId: 'cohort-9',
  event: CaptureEvent.ORDER_FILLED,
  symbol: 'GOOG',
  positionType: PositionType.VERTICAL_DEBIT_SPREAD,
  carrier: { kind: 'engine-position', docPath: POSITION_DOC },
};

type DocMap = Record<string, unknown>;

interface FakeStore {
  carriers: Map<string, DocMap>;
  index: Map<string, DocMap>;
}

/** Fake deps: `transact` runs the work callback against plain maps — reads
 *  see committed state, writes apply inside the callback (mirrors the real
 *  runTransaction contract closely enough for the ledger's logic). */
function makeDeps(
  overrides: {
    carrierEvents?: Record<string, CapturedEventEntry>;
    capture?: LifecycleCaptureDeps['capture'];
    timeoutMs?: number;
    staleClaimMs?: number;
    now?: () => Date;
    transactError?: Error;
  } = {},
) {
  const store: FakeStore = { carriers: new Map(), index: new Map() };
  if (overrides.carrierEvents) {
    store.carriers.set(BASE_INPUT.carrier.docPath, {
      [CAPTURED_EVENTS_FIELD]: { ...overrides.carrierEvents },
    });
  }
  const captureSpecs: CaptureChartSpec[] = [];
  const deps: LifecycleCaptureDeps = {
    transact: async <T>(work: (txn: LifecycleTxn) => Promise<T>): Promise<T> => {
      if (overrides.transactError) throw overrides.transactError;
      return work({
        readCarrierEvents: async (docPath) =>
          (store.carriers.get(docPath)?.[CAPTURED_EVENTS_FIELD] as
            | Record<string, CapturedEventEntry>
            | undefined) ?? {},
        writeCarrierEvent: (docPath, event, entry) => {
          const doc = store.carriers.get(docPath) ?? {};
          const events = (doc[CAPTURED_EVENTS_FIELD] as Record<string, CapturedEventEntry>) ?? {};
          doc[CAPTURED_EVENTS_FIELD] = { ...events, [event]: entry };
          store.carriers.set(docPath, doc);
        },
        writeIndex: (docId, entry) => {
          store.index.set(docId, entry as unknown as DocMap);
        },
      });
    },
    capture: overrides.capture ?? jest.fn(async (spec) => (captureSpecs.push(spec), CAPTURED)),
    now: overrides.now ?? (() => NOW),
    timeoutMs: overrides.timeoutMs,
    staleClaimMs: overrides.staleClaimMs,
  };
  return { deps, store, captureSpecs };
}

function entryAt(store: FakeStore, docPath: string, event: string): CapturedEventEntry {
  const events = store.carriers.get(docPath)?.[CAPTURED_EVENTS_FIELD] as
    | Record<string, CapturedEventEntry>
    | undefined;
  return events?.[event] as CapturedEventEntry;
}

describe('captureLifecycleEvent — dedup claim', () => {
  it('claims the event slot with a pending marker before invoking the capture', async () => {
    let eventsAtCapture: Record<string, CapturedEventEntry> | undefined;
    const { deps, store } = makeDeps();
    deps.capture = async () => {
      const doc = store.carriers.get(BASE_INPUT.carrier.docPath);
      eventsAtCapture = doc?.[CAPTURED_EVENTS_FIELD] as Record<string, CapturedEventEntry>;
      return CAPTURED;
    };
    const outcome = await captureLifecycleEvent(BASE_INPUT, deps);
    expect(outcome.status).toBe('captured');
    expect(eventsAtCapture?.[CaptureEvent.ORDER_FILLED].status).toBe('pending');
  });

  it('skips a second capture for the same (carrier, event) without invoking the core', async () => {
    const { deps, captureSpecs } = makeDeps();
    await captureLifecycleEvent(BASE_INPUT, deps);
    const second = await captureLifecycleEvent(BASE_INPUT, deps);
    expect(second).toEqual({ status: 'skipped-duplicate' });
    expect(captureSpecs.length).toBe(1);
  });

  it('skips when a fresh pending claim already exists (concurrent trigger loses)', async () => {
    const pending: CapturedEventEntry = {
      status: 'pending',
      claimedAt: NOW.toISOString(),
    };
    const { deps, captureSpecs } = makeDeps({
      carrierEvents: { [CaptureEvent.ORDER_FILLED]: pending },
    });
    const outcome = await captureLifecycleEvent(BASE_INPUT, deps);
    expect(outcome).toEqual({ status: 'skipped-duplicate' });
    expect(captureSpecs.length).toBe(0);
  });

  it('reclaims a stale pending claim so a crashed capture cannot wedge retries', async () => {
    const stale: CapturedEventEntry = {
      status: 'pending',
      claimedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    };
    const { deps, captureSpecs } = makeDeps({
      carrierEvents: { [CaptureEvent.ORDER_FILLED]: stale },
      staleClaimMs: 60_000,
    });
    const outcome = await captureLifecycleEvent(BASE_INPUT, deps);
    expect(outcome.status).toBe('captured');
    expect(captureSpecs.length).toBe(1);
  });

  it('retries after a failed marker', async () => {
    const failed: CapturedEventEntry = {
      status: 'failed',
      claimedAt: NOW.toISOString(),
      error: 'boom',
    };
    const { deps, store } = makeDeps({
      carrierEvents: { [CaptureEvent.ORDER_FILLED]: failed },
    });
    const outcome = await captureLifecycleEvent(BASE_INPUT, deps);
    expect(outcome.status).toBe('captured');
    expect(entryAt(store, BASE_INPUT.carrier.docPath, CaptureEvent.ORDER_FILLED).status).toBe('captured');
  });
});

describe('captureLifecycleEvent — happy path', () => {
  it('invokes the capture core with renderOnly:false and the lifecycle spec fields', async () => {
    const { deps, captureSpecs } = makeDeps();
    const outcome = await captureLifecycleEvent(BASE_INPUT, deps);
    expect(outcome).toEqual({ status: 'captured', paths: CAPTURED.paths });
    expect(captureSpecs.length).toBe(1);
    const spec = captureSpecs[0];
    expect(spec.renderOnly).toBe(false);
    expect(spec.symbol).toBe('GOOG');
    expect(spec.event).toBe(CaptureEvent.ORDER_FILLED);
    expect(spec.positionType).toBe(PositionType.VERTICAL_DEBIT_SPREAD);
    expect(spec.groupId).toBe('cohort-9');
    expect(spec.refId).toBe('pos-1-order-filled');
  });

  it('commits a captured manifest entry on the carrier doc', async () => {
    const { deps, store } = makeDeps();
    await captureLifecycleEvent(BASE_INPUT, deps);
    const entry = entryAt(store, BASE_INPUT.carrier.docPath, CaptureEvent.ORDER_FILLED);
    expect(entry.status).toBe('captured');
    expect(entry.capturedAt).toBe(NOW.toISOString());
    expect(entry.paths).toEqual(CAPTURED.paths);
  });

  it('writes the st-screenshots index doc with deterministic id {groupId}-{refId}-{event}', async () => {
    const { deps, store } = makeDeps();
    await captureLifecycleEvent(BASE_INPUT, deps);
    const docId = screenshotIndexDocId('cohort-9', 'pos-1-order-filled', CaptureEvent.ORDER_FILLED);
    const idx = store.index.get(docId) as Record<string, unknown>;
    expect(idx).toBeDefined();
    expect(idx.groupId).toBe('cohort-9');
    expect(idx.positionId).toBe('pos-1');
    expect(idx.event).toBe(CaptureEvent.ORDER_FILLED);
    expect(idx.symbol).toBe('GOOG');
    expect(idx.capturedAt).toBe(NOW.toISOString());
    expect(idx.paths).toEqual(CAPTURED.paths);
  });

  it('ledgers on an intent carrier the same way (both carrier kinds)', async () => {
    const input: LifecycleCaptureInput = {
      ...BASE_INPUT,
      carrier: { kind: 'intent', docPath: INTENT_DOC },
    };
    const { deps, store } = makeDeps();
    const outcome = await captureLifecycleEvent(input, deps);
    expect(outcome.status).toBe('captured');
    expect(entryAt(store, INTENT_DOC, CaptureEvent.ORDER_FILLED).status).toBe('captured');
  });

  it('writes the index doc without the group prefix when groupId is absent', async () => {
    const input: LifecycleCaptureInput = { ...BASE_INPUT, groupId: undefined };
    const { deps, store, captureSpecs } = makeDeps();
    await captureLifecycleEvent(input, deps);
    expect(captureSpecs[0].groupId).toBeUndefined();
    const docId = screenshotIndexDocId(undefined, 'pos-1-order-filled', CaptureEvent.ORDER_FILLED);
    const idx = store.index.get(docId) as Record<string, unknown>;
    expect(idx).toBeDefined();
    // Firestore rejects explicit undefined values — the key must be absent.
    expect('groupId' in idx).toBe(false);
  });
});

describe('captureLifecycleEvent — failure handling', () => {
  it('swallows a capture throw, marks the carrier failed, and stays retryable', async () => {
    const { deps, store } = makeDeps({
      capture: async () => {
        throw new Error('insufficient bars');
      },
    });
    const outcome = await captureLifecycleEvent(BASE_INPUT, deps);
    expect(outcome.status).toBe('failed');
    expect((outcome as { error: string }).error).toContain('insufficient bars');
    const entry = entryAt(store, BASE_INPUT.carrier.docPath, CaptureEvent.ORDER_FILLED);
    expect(entry.status).toBe('failed');
    expect(entry.error).toContain('insufficient bars');
  });

  it('fails rather than hanging when the capture exceeds the await cap', async () => {
    const never = new Promise<CaptureChartResult>(() => {});
    const { deps, store } = makeDeps({
      capture: () => never,
      timeoutMs: 10,
    });
    const outcome = await captureLifecycleEvent(BASE_INPUT, deps);
    expect(outcome.status).toBe('failed');
    expect((outcome as { error: string }).error).toContain('timeout');
    expect(entryAt(store, BASE_INPUT.carrier.docPath, CaptureEvent.ORDER_FILLED).status).toBe('failed');
  });

  it('never propagates even if the claim transaction itself throws', async () => {
    const { deps } = makeDeps({ transactError: new Error('firestore down') });
    const outcome = await captureLifecycleEvent(BASE_INPUT, deps);
    expect(outcome.status).toBe('failed');
  });
});

describe('screenshotIndexDocId', () => {
  it('composes {groupId}-{refId}-{event} and strips path-hostile characters', () => {
    expect(screenshotIndexDocId('cohort-9', 'pos-1-order-filled', CaptureEvent.ORDER_FILLED)).toBe(
      'cohort-9-pos-1-order-filled-order-filled',
    );
    expect(screenshotIndexDocId('a/b', 'x y', CaptureEvent.MANUAL)).toBe('a-b-x-y-manual');
  });
});

describe('constants', () => {
  it('await cap is a reasonable order-path budget', () => {
    expect(LIFECYCLE_CAPTURE_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(LIFECYCLE_CAPTURE_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });
});
