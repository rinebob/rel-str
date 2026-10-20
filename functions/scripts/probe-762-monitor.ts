// Read-only probe: what flags/docs exist for BTSG+TDY that could status
// a gallery card? Symbol docs, review-list, tickets, signals, meta.
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';

initializeApp({ projectId: 'rel-str' });
const db = getFirestore();
const WANT = ['BTSG', 'TDY'];

async function main() {
  console.log('=== symbol docs ===');
  for (const s of WANT) {
    for (const root of ['savant-trader/data/symbols', 'st-symbols']) {
      const d = await db.doc(`${root}/${s}`).get();
      if (d.exists) console.log(`${root}/${s}:`, JSON.stringify(d.data()).slice(0, 800));
    }
  }

  console.log('\n=== review-list (all docs) ===');
  const rl = await db.collection('savant-trader/data/review-list').get();
  for (const d of rl.docs) console.log(d.id, JSON.stringify(d.data()).slice(0, 300));

  console.log('\n=== st-order-tickets mentioning BTSG/TDY ===');
  const tk = await db.collection('st-order-tickets').get();
  for (const d of tk.docs) {
    const j = JSON.stringify(d.data());
    if (WANT.some((w) => j.includes(`"${w}"`))) console.log(d.id, j.slice(0, 500));
  }
  console.log(`(scanned ${tk.size} tickets)`);

  console.log('\n=== symbol-meta ===');
  const sm = await db.collection('savant-trader/data/symbol-meta').get();
  for (const d of sm.docs) if (WANT.includes(d.id)) console.log(d.id, JSON.stringify(d.data()).slice(0, 500));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
