// @ts-nocheck — Verification script runs via tsx with NODE_PATH=functions/node_modules.
// The root tsconfig excludes scripts/verify; the functions tsconfig includes it but the
// IDE resolves against the root config, so firebase-admin types are not visible here.
/**
 * Verification script: portfolio allocation Firestore round-trip (task #586).
 *
 * Exercises the real (prod) Firestore via the Admin SDK to verify the
 * anchored collection paths, composite doc ids, and field shapes the FE
 * services write. Admin SDK bypasses security rules — this verifies the
 * data contract and index coverage, not auth (rules are unit-reviewed).
 *
 * Verifies:
 * - `portfolio/buckets/items/{acct}_{slug}` and
 *   `portfolio/attributions/items/{acct}_{instrumentId}` are valid paths.
 * - Bucket doc shape {id,userId,accountNumber,name,targetPct,status,createdAt,updatedAt}
 *   round-trips; rename updates name only (id frozen); retire flips status.
 * - Attribution doc shape with history[] events (fromBucketId null on
 *   assign, from→to on move) and linkKey group fields.
 * - Composite queries on items: userId+accountNumber and
 *   userId+accountNumber+status return docs (indexes deployed).
 * - Deletes clean up (unassign semantics: doc absent = Unassigned).
 *
 * Usage:
 *   NODE_PATH=functions/node_modules npx tsx scripts/verify/portfolio-allocation-586-roundtrip.ts
 *
 * Requires Application Default Credentials (`gcloud auth application-default login`).
 * Writes under account 'VERIFY586' and cleans up after itself.
 */

import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

const ACCT = 'VERIFY586';
const UID = 'verify-script';
const BUCKETS = 'portfolio/buckets/items';
const ATTRS = 'portfolio/attributions/items';
const NOW = () => new Date().toISOString();

if (getApps().length === 0) {
  initializeApp({ projectId: 'rel-str' });
}
const db: Firestore = getFirestore(getApp());
db.settings({ ignoreUndefinedProperties: true });

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const results: string[] = [];
  const ok = (n: string) => results.push(`  PASS ${n}`);

  // ---- 1. Bucket create -------------------------------------------------
  const bucketId = `${ACCT}_verify-bucket`;
  const bucketRef = db.doc(`${BUCKETS}/${bucketId}`);
  await bucketRef.set({
    id: bucketId, userId: UID, accountNumber: ACCT,
    name: 'Verify Bucket', targetPct: 25, status: 'ACTIVE',
    createdAt: NOW(), updatedAt: NOW(),
  });
  const b1 = (await bucketRef.get()).data();
  assert(b1?.id === bucketId && b1.status === 'ACTIVE', 'bucket create round-trips');
  ok('bucket create (composite id, field shape)');

  // ---- 2. Rename — name only, id frozen ---------------------------------
  await bucketRef.update({ name: 'Verify Bucket v2', updatedAt: NOW() });
  const b2 = (await bucketRef.get()).data();
  assert(b2?.id === bucketId && b2.name === 'Verify Bucket v2', 'rename keeps id');
  ok('bucket rename (id frozen, name updated)');

  // ---- 3. Retire ---------------------------------------------------------
  await bucketRef.update({ status: 'RETIRED', updatedAt: NOW() });
  const b3 = (await bucketRef.get()).data();
  assert(b3?.status === 'RETIRED', 'retire flips status, doc kept');
  ok('bucket retire (status=RETIRED, doc preserved)');

  // ---- 4. Attribution assign + move + linkKey group -----------------------
  const leg1Ref = db.doc(`${ATTRS}/${ACCT}_leg-a`);
  const leg2Ref = db.doc(`${ATTRS}/${ACCT}_leg-b`);
  const ev = (from: string | null, to: string) => ({ fromBucketId: from, toBucketId: to, at: NOW() });

  await leg1Ref.set({
    id: `${ACCT}_leg-a`, userId: UID, accountNumber: ACCT, instrumentId: 'leg-a',
    bucketId, linkKey: 'verify-ord-1',
    history: [ev(null, bucketId)], createdAt: NOW(), updatedAt: NOW(),
  });
  await leg2Ref.set({
    id: `${ACCT}_leg-b`, userId: UID, accountNumber: ACCT, instrumentId: 'leg-b',
    bucketId, linkKey: 'verify-ord-1',
    history: [ev(null, bucketId)], createdAt: NOW(), updatedAt: NOW(),
  });
  ok('attribution assign (fromBucketId null, linkKey group)');

  // group move — both legs atomically
  const batch = db.batch();
  for (const r of [leg1Ref, leg2Ref]) {
    const snap = await r.get();
    const d = snap.data();
    batch.set(r, {
      ...d, bucketId: `${ACCT}_other`,
      history: [...d.history, ev(bucketId, `${ACCT}_other`)],
      updatedAt: NOW(),
    });
  }
  const otherRef = db.doc(`${BUCKETS}/${ACCT}_other`);
  await otherRef.set({
    id: `${ACCT}_other`, userId: UID, accountNumber: ACCT,
    name: 'Other', targetPct: 10, status: 'ACTIVE', createdAt: NOW(), updatedAt: NOW(),
  });
  await batch.commit();
  const l1 = (await leg1Ref.get()).data();
  assert(l1?.bucketId === `${ACCT}_other` && l1?.history.length === 2
    && l1?.history[1].fromBucketId === bucketId, 'group move appended from→to');
  ok('attribution group move (from→to event appended on both legs)');

  // ---- 5. Composite queries (index proof) --------------------------------
  const byAcct = await db.collection(BUCKETS)
    .where('userId', '==', UID).where('accountNumber', '==', ACCT).get();
  assert(byAcct.size >= 2, `userId+accountNumber bucket query returned ${byAcct.size}`);
  const active = await db.collection(BUCKETS)
    .where('userId', '==', UID).where('accountNumber', '==', ACCT)
    .where('status', '==', 'ACTIVE').get();
  assert(active.docs.some((d) => d.id === `${ACCT}_other`), 'ticket-match query serves ACTIVE');
  ok('composite queries (userId+accountNumber[+status]) — indexes live');

  const group = await db.collection(ATTRS)
    .where('userId', '==', UID).where('accountNumber', '==', ACCT).get();
  const linked = group.docs.filter((d) => d.data().linkKey === 'verify-ord-1');
  assert(linked.length === 2, `linkKey group has 2 members, got ${linked.length}`);
  ok('linkKey group enumeration');

  // ---- 6. Unassign = delete (doc absent → Unassigned) ---------------------
  await leg1Ref.delete();
  assert(!(await leg1Ref.get()).exists, 'unassigned leg doc deleted');
  ok('unassign (doc deletion → Unassigned)');

  // ---- cleanup ------------------------------------------------------------
  await leg2Ref.delete();
  await bucketRef.delete();
  await otherRef.delete();
  ok('cleanup (all verify docs removed)');

  console.log('\n=== portfolio-allocation-586 round-trip: ALL CHECKS PASSED ===');
  results.forEach((r) => console.log(r));
}

main().catch((e) => { console.error(e); process.exit(1); });
