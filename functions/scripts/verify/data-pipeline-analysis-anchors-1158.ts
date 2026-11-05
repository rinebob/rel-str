/**
 * Read-only parity relay for #1158 — legacy
 * `paper-trading/analysis-datasets|analysis-slices` anchors ⇄ canonical
 * `st-paper-trading/analysis-datasets|analysis-slices` items.
 *
 * For every legacy doc:
 *   - a canonical twin exists with field-level parity (verbatim copy —
 *     deep-equal every field, no canonical-only keys),
 *   - datasets: the `chunks` subcollection is fully mirrored (same doc
 *     ids, same fields — the workbench CSV mirror read depends on it).
 *
 * Canonical-only docs are reported INFO, not FAIL — post-cutover writers
 * (generateTradeDataset callable, workbench slice saves) mint
 * canonical-only docs by design. Legacy-only docs FAIL: they would be
 * orphaned by the reader cutover.
 *
 * Evidence floors: empty legacy legs can't pass vacuously — before the
 * archive+delete step the legacy anchors still hold the pre-cutover
 * docs. After the legacy anchors are deleted this relay fails by
 * design — it is a pre-delete gate only.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-analysis-anchors-1158.ts
 *
 * Prerequisites: ADC with prod Firestore access; read-only — never writes.
 */
import { db } from '../../src/firebase-admin-init';
import { deepEqual } from '../../src/order-tickets/legacy-order-intents';

const LEGACY_ROOT = 'paper-trading';
const ST_ROOT = 'st-paper-trading';

const LEGS = [
  { anchor: 'analysis-datasets', sub: 'chunks' },
  { anchor: 'analysis-slices', sub: null },
] as const;

let failures = 0;
function fail(msg: string): void {
  failures++;
  console.log(`FAIL ${msg}`);
}
function ok(msg: string): void {
  console.log(`OK   ${msg}`);
}
function info(msg: string): void {
  console.log(`INFO ${msg}`);
}

/** Field-level parity — verbatim copy iff every legacy field deep-equals
 *  the canonical value and no canonical-only keys exist. Returns the
 *  first divergent key path or null. */
function firstDiff(
  incoming: Record<string, unknown>,
  existing: FirebaseFirestore.DocumentData,
): string | null {
  for (const [k, v] of Object.entries(incoming)) {
    if (!deepEqual(existing[k], v)) return k;
  }
  for (const k of Object.keys(existing)) {
    if (!Object.hasOwn(incoming, k)) return `+${k}`;
  }
  return null;
}

async function checkDoc(
  legacyPath: string,
  stPath: string,
): Promise<boolean> {
  const [l, s] = await Promise.all([db.doc(legacyPath).get(), db.doc(stPath).get()]);
  if (!s.exists) {
    fail(`${stPath} — missing canonical twin for ${legacyPath}`);
    return false;
  }
  const ld = l.data();
  if (!ld) {
    fail(`${legacyPath} — vanished mid-run`);
    return false;
  }
  const diff = firstDiff(ld, s.data()!);
  if (diff !== null) {
    fail(`${stPath} — field '${diff}' diverges from ${legacyPath}`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  console.log('analysis-anchors parity relay — #1158\n');

  for (const leg of LEGS) {
    const legacyCol = `${LEGACY_ROOT}/${leg.anchor}/items`;
    const stCol = `${ST_ROOT}/${leg.anchor}/items`;

    const [legacySnap, stSnap] = await Promise.all([
      db.collection(legacyCol).get(),
      db.collection(stCol).get(),
    ]);

    // Evidence floor — the pre-delete gate must see real docs.
    if (legacySnap.empty) {
      fail(`${legacyCol} is empty — no parity evidence (post-delete this is expected; the relay is a pre-delete gate)`);
      continue;
    }

    const stIds = new Set(stSnap.docs.map((d) => d.id));
    let legOk = 0;
    let legFail = 0;

    for (const doc of legacySnap.docs) {
      const good = await checkDoc(doc.ref.path, `${stCol}/${doc.id}`);
      good ? legOk++ : legFail++;

      // Skip the sub-check when the parent already failed — one FAIL per root cause.
      if (leg.sub && good) {
        const [lSub, sSub] = await Promise.all([
          db.collection(`${doc.ref.path}/${leg.sub}`).get(),
          db.collection(`${stCol}/${doc.id}/${leg.sub}`).get(),
        ]);
        const sSubMap = new Map(sSub.docs.map((d) => [d.id, d.data()]));
        if (lSub.size !== sSubMap.size || lSub.docs.some((d) => !sSubMap.has(d.id))) {
          fail(`${stCol}/${doc.id}/${leg.sub} — ${lSub.size} legacy chunk(s) vs ${sSub.size} canonical`);
          legFail++;
        } else {
          for (const c of lSub.docs) {
            const diff = firstDiff(c.data(), sSubMap.get(c.id)!);
            if (diff !== null) {
              fail(`${stCol}/${doc.id}/${leg.sub}/${c.id} — field '${diff}' diverges`);
              legFail++;
            }
          }
        }
      }
    }

    const extra = [...stIds].filter((id) => !legacySnap.docs.some((d) => d.id === id));
    if (extra.length > 0) {
      info(`${stCol} — ${extra.length} canonical-only doc(s) (post-cutover writes): ${extra.join(', ')}`);
    }

    if (legFail === 0) {
      ok(`${leg.anchor} — ${legOk}/${legacySnap.size} docs verbatim (${stSnap.size} canonical total)`);
    }
  }

  console.log(failures === 0 ? '\n=== ANALYSIS-ANCHORS PARITY OK ===' : `\n=== ${failures} FAIL(s) ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
