/**
 * One-time Firestore migration: rh-agent-* → savant-trader/data/*
 *
 * Copies all documents from the old collection paths to the new paths.
 * Run from the functions/ directory so firebase-admin is available.
 *
 * Usage: node scripts/migrate-st-collections.js
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'rel-str' });
const db = admin.firestore();

const MIGRATIONS = [
  { from: 'rh-agent-runs', to: 'savant-trader/data/runs', subcollections: ['jobs'] },
  { from: 'rh-agent-symbols', to: 'savant-trader/data/symbols', subcollections: ['run-ids', 'signal-history'] },
  { from: 'rh-agent-occurrence-decisions', to: 'savant-trader/data/occurrence-decisions', subcollections: [] },
  { from: 'rh-agent-triage-decisions', to: 'savant-trader/data/review-list', subcollections: [] },
  { from: 'rh-agent-symbol-lists', to: 'savant-trader/data/symbol-lists', subcollections: [] },
  { from: 'rh-agent-status', to: 'savant-trader/data/status', subcollections: [] },
];

async function migrateCollection(fromPath, toPath, subcollections) {
  const snapshot = await db.collection(fromPath).get();
  console.log(`Migrating ${fromPath} → ${toPath} (${snapshot.size} docs)`);

  let migrated = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const destRef = db.collection(toPath).doc(doc.id);

    // Copy the document
    await destRef.set(data);
    migrated++;

    // Copy subcollections
    for (const subName of subcollections) {
      const subSnapshot = await db.collection(fromPath).doc(doc.id).collection(subName).get();
      if (subSnapshot.size > 0) {
        console.log(`  ${doc.id}/${subName}: ${subSnapshot.size} subdocs`);
        for (const subDoc of subSnapshot.docs) {
          await destRef.collection(subName).doc(subDoc.id).set(subDoc.data());
        }
      }
    }

    if (migrated % 50 === 0) {
      console.log(`  ...${migrated}/${snapshot.size}`);
    }
  }
  console.log(`  Done: ${migrated} docs migrated`);
  return migrated;
}

async function main() {
  console.log('=== ST Collection Migration ===');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('');

  let totalDocs = 0;
  for (const { from, to, subcollections } of MIGRATIONS) {
    const count = await migrateCollection(from, to, subcollections);
    totalDocs += count;
    console.log('');
  }

  console.log(`=== Migration complete: ${totalDocs} total docs migrated ===`);
  process.exit(0);
}

main().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
