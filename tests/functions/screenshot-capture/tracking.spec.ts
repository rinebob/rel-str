/**
 * @topic #746 — On-demand Screenshot Capture (task #846)
 *
 * tracking.ts — carrier builders (intent / engine-position doc paths) and
 * the st-order-intents tracking-field I/O behind the narrow TrackingDb
 * seam. The fake is a plain doc map; the real seam is the admin Firestore.
 */
import { CAPTURED_EVENTS_FIELD } from '@screenshot-capture/contracts';
import {
  enginePositionCarrier,
  intentCarrier,
  intentDocPath,
  readCapturedEvents,
  readIntentTracking,
  screenshotIndexDocPath,
  writeIntentLastSeenState,
  writeIntentTracking,
  type TrackingDb,
} from '../../../functions/src/screenshot-capture/tracking';

const INTENT_ID = 'intent-abc';

function fakeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, Record<string, unknown>>(
    Object.entries(seed).map(([k, v]) => [k, { ...v }]),
  );
  const sets: { path: string; data: Record<string, unknown>; merge: boolean }[] = [];
  const db: TrackingDb = {
    doc(path: string) {
      const ref = {
        exists: store.has(path),
        data: () => store.get(path),
        set: async (data: Record<string, unknown>, opts: { merge: boolean }) => {
          sets.push({ path, data, merge: opts.merge });
          store.set(
            path,
            opts.merge ? { ...(store.get(path) ?? {}), ...data } : { ...data },
          );
        },
        get: async () => ({
          get exists() {
            return store.has(path);
          },
          data: () => store.get(path),
        }),
      };
      return ref;
    },
  };
  return { db, store, sets };
}

describe('carrier builders', () => {
  it('intentCarrier points at the st-order-intents doc', () => {
    expect(intentDocPath(INTENT_ID)).toBe(
      'savant-trader/data/order-intents/intent-abc',
    );
    expect(intentCarrier(INTENT_ID)).toEqual({
      kind: 'intent',
      docPath: 'savant-trader/data/order-intents/intent-abc',
    });
  });

  it('enginePositionCarrier passes the caller doc path through', () => {
    expect(enginePositionCarrier('paper-trading/positions/items/p1')).toEqual({
      kind: 'engine-position',
      docPath: 'paper-trading/positions/items/p1',
    });
  });

  it('screenshotIndexDocPath composes under the flat st-screenshots root', () => {
    expect(screenshotIndexDocPath('cohort-9-pos-1-order-filled-order-filled')).toBe(
      'st-screenshots/cohort-9-pos-1-order-filled-order-filled',
    );
  });
});

describe('intent tracking I/O', () => {
  it('readIntentTracking returns the fields off an existing doc', async () => {
    const { db } = fakeDb({
      [intentDocPath(INTENT_ID)]: {
        role: 'open',
        linkedPositionId: 'pos-9',
        signalId: 'sig-1',
        lastSeenState: 'resting',
        capturedEvents: {
          'order-placed': { status: 'captured', claimedAt: 't', capturedAt: 't2', paths: ['p'] },
        },
        unrelatedField: 42,
      },
    });
    const fields = await readIntentTracking(db, INTENT_ID);
    expect(fields).toEqual({
      role: 'open',
      linkedPositionId: 'pos-9',
      signalId: 'sig-1',
      lastSeenState: 'resting',
      capturedEvents: {
        'order-placed': { status: 'captured', claimedAt: 't', capturedAt: 't2', paths: ['p'] },
      },
    });
  });

  it('readIntentTracking resolves undefined for a missing doc', async () => {
    const { db } = fakeDb();
    expect(await readIntentTracking(db, 'nope')).toBeUndefined();
  });

  it('writeIntentTracking merge-writes fields without clobbering siblings', async () => {
    const { db, store, sets } = fakeDb({
      [intentDocPath(INTENT_ID)]: { status: 'submitted', role: 'open' },
    });
    await writeIntentTracking(db, INTENT_ID, {
      linkedPositionId: 'pos-9',
      lastSeenState: 'filled',
    });
    expect(sets[0].merge).toBe(true);
    const doc = store.get(intentDocPath(INTENT_ID))!;
    expect(doc.status).toBe('submitted');
    expect(doc.role).toBe('open');
    expect(doc.linkedPositionId).toBe('pos-9');
    expect(doc.lastSeenState).toBe('filled');
  });

  it('writeIntentTracking drops explicit undefined values (Firestore rejects them)', async () => {
    const { db, sets } = fakeDb({ [intentDocPath(INTENT_ID)]: {} });
    await writeIntentTracking(db, INTENT_ID, {
      role: 'close',
      linkedPositionId: undefined,
      signalId: undefined,
    });
    expect(sets[0].data).toEqual({ role: 'close' });
  });

  it('writeIntentLastSeenState writes only the detector bookkeeping field', async () => {
    const { db, sets } = fakeDb({ [intentDocPath(INTENT_ID)]: {} });
    await writeIntentLastSeenState(db, INTENT_ID, 'queued');
    expect(sets[0].data).toEqual({ lastSeenState: 'queued' });
  });
});

describe('readCapturedEvents', () => {
  it('returns the ledger map off a carrier doc', async () => {
    const docPath = 'paper-trading/positions/items/p1';
    const ledger = {
      'order-filled': { status: 'captured', claimedAt: 't', capturedAt: 't2', paths: ['a.svg'] },
    };
    const { db } = fakeDb({ [docPath]: { [CAPTURED_EVENTS_FIELD]: ledger } });
    expect(await readCapturedEvents(db, docPath)).toEqual(ledger);
  });

  it('returns {} for a missing doc or a doc without the field', async () => {
    const { db } = fakeDb({ 'x/y': { other: 1 } });
    expect(await readCapturedEvents(db, 'x/y')).toEqual({});
    expect(await readCapturedEvents(db, 'x/missing')).toEqual({});
  });
});
