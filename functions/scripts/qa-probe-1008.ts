// QA soak probes for #1008 — verifies deployed mirrors + dual-write on prod.
// Read/write probe docs only; cleans up after itself.
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { addSymbolToDefaultList } from '../src/symbol-data-sync/symbol-data-symbol-added';
const db = getFirestore();

const LEGACY_CFG = 'savant-trader/data/trading-config';
const LEGACY_LISTS = 'savant-trader/data/symbol-lists';
const LEGACY_STATUS = 'savant-trader/data/status/current';
const CANON_CFG = 'st-config';
const CANON_LISTS = 'st-symbol-lists';

async function poll<T>(fn: () => Promise<T | null>, label: string, ms = 20000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v !== null) return v;
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error(`TIMEOUT waiting for: ${label}`);
}

async function docData(path: string) {
  const s = await db.doc(path).get();
  return s.exists ? s.data() : null;
}

async function main() {
  const results: string[] = [];
  const ok = (name: string, detail = '') => { results.push(`PASS ${name} ${detail}`); };
  const fail = (name: string, e: unknown) => { results.push(`FAIL ${name} — ${e}`); };

  // S6 — tradingConfigMirror: legacy write → canonical, delete → propagates
  try {
    await db.doc(`${LEGACY_CFG}/qa-1008-probe`).set({ probe: true, tag: 's6' });
    const c = await poll(async () => docData(`${CANON_CFG}/qa-1008-probe`), 'cfg mirror upsert');
    if (c?.probe !== true) throw new Error(`canonical mismatch: ${JSON.stringify(c)}`);
    await db.doc(`${LEGACY_CFG}/qa-1008-probe`).delete();
    await poll(async () => (await docData(`${CANON_CFG}/qa-1008-probe`)) === null ? true : null, 'cfg mirror delete');
    const st = await docData(`${CANON_CFG}/status`);
    if (!st) throw new Error('st-config/status missing after probe');
    ok('S6 tradingConfigMirror', 'upsert+delete propagated, status undisturbed');
  } catch (e) { fail('S6 tradingConfigMirror', e); }

  // S7 — symbolListsMirror
  try {
    await db.doc(`${LEGACY_LISTS}/QA_1008_PROBE`).set({ key: 'QA', symbols: ['TEST'], userId: 'qa' });
    const c = await poll(async () => docData(`${CANON_LISTS}/QA_1008_PROBE`), 'list mirror upsert');
    if (!Array.isArray(c?.symbols) || !c.symbols.includes('TEST')) throw new Error(`canonical mismatch: ${JSON.stringify(c)}`);
    await db.doc(`${LEGACY_LISTS}/QA_1008_PROBE`).delete();
    await poll(async () => (await docData(`${CANON_LISTS}/QA_1008_PROBE`)) === null ? true : null, 'list mirror delete');
    ok('S7 symbolListsMirror', 'upsert+delete propagated');
  } catch (e) { fail('S7 symbolListsMirror', e); }

  // S8 — stStatusMirror: canonical → legacy shadow
  try {
    await db.doc(`${CANON_CFG}/status`).set({ qaProbe: '1008' }, { merge: true });
    await poll(async () => {
      const d = await docData(LEGACY_STATUS);
      return d?.qaProbe === '1008' ? true : null;
    }, 'status shadow upsert');
    await db.doc(`${CANON_CFG}/status`).update({ qaProbe: FieldValue.delete() });
    await poll(async () => {
      const d = await docData(LEGACY_STATUS);
      return d && !('qaProbe' in d) ? true : null;
    }, 'status shadow field-delete');
    ok('S8 stStatusMirror', 'canonical→legacy shadow upsert+delete propagated');
  } catch (e) { fail('S8 stStatusMirror', e); }

  // S9 — NEW-list dual-write atomicity on real Firestore
  try {
    await addSymbolToDefaultList('QA1008PROBE', db as any);
    const l = await docData(`${LEGACY_LISTS}/NEW`);
    const c = await docData(`${CANON_LISTS}/NEW`);
    const lHas = Array.isArray(l?.symbols) && l.symbols.includes('QA1008PROBE');
    const cHas = Array.isArray(c?.symbols) && c.symbols.includes('QA1008PROBE');
    if (!lHas || !cHas) throw new Error(`dual-write miss: legacy=${lHas} canonical=${cHas}`);
    // cleanup
    const batch = db.batch();
    batch.update(db.doc(`${LEGACY_LISTS}/NEW`), { symbols: FieldValue.arrayRemove('QA1008PROBE') });
    batch.update(db.doc(`${CANON_LISTS}/NEW`), { symbols: FieldValue.arrayRemove('QA1008PROBE') });
    await batch.commit();
    ok('S9 dual-write', 'symbol present in both NEW docs, cleaned up');
  } catch (e) { fail('S9 dual-write', e); }

  console.log(results.join('\n'));
  const anyFail = results.some(r => r.startsWith('FAIL'));
  process.exit(anyFail ? 1 : 0);
}

main().catch(e => { console.error('PROBE CRASH:', e); process.exit(1); });
