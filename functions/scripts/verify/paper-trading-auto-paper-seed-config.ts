/**
 * Seed `savant-trader/data/trading-config/autoPaper` for #920 umbrella QA.
 *
 * Resolves ownerUid from the `{uid}_PRIMARY` symbol-list doc id (the same
 * lookup the ingest pass uses), writes { enabled, lists, ownerUid }, then
 * reads the doc back to confirm. One real write to prod.
 *
 * Usage (from functions/):  npx tsx scripts/verify/paper-trading-auto-paper-seed-config.ts
 */
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { ST_SYMBOL_LISTS_COLLECTION, ST_TRADING_CONFIG_COLLECTION, AUTO_PAPER_CONFIG_DOC } from '../../src/common/st-collections.js';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const listSnap = await db
  .collection(ST_SYMBOL_LISTS_COLLECTION)
  .where('key', '==', 'PRIMARY')
  .get();
if (listSnap.size !== 1) throw new Error(`expected 1 PRIMARY doc, got ${listSnap.size}`);

const primaryId = listSnap.docs[0].id;
if (!primaryId.endsWith('_PRIMARY')) throw new Error(`unexpected PRIMARY doc id: ${primaryId}`);
const ownerUid = primaryId.slice(0, -'_PRIMARY'.length);
console.log(`PRIMARY doc: ${primaryId} → ownerUid: ${ownerUid}`);

const ref = db.collection(ST_TRADING_CONFIG_COLLECTION).doc(AUTO_PAPER_CONFIG_DOC);
const before = await ref.get();
console.log(`existing config: ${before.exists ? JSON.stringify(before.data()) : '(none)'}`);

await ref.set({ enabled: true, lists: ['PRIMARY'], ownerUid });

const after = await ref.get();
console.log(`written config: ${JSON.stringify(after.data())}`);
if (after.data()?.enabled !== true) throw new Error('read-back mismatch');
console.log('=== SEEDED ===');
