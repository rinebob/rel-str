/* Seed Firestore emulator with partner-events resembling production */
// Usage: Ensure Firestore emulator is running on 127.0.0.1:8088, then run:
//   set FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 && node scripts/seed-partner-events.js

const admin = require('firebase-admin');

function initAdmin() {
  if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.GCLOUD_PROJECT) {
    process.env.GOOGLE_CLOUD_PROJECT = 'rel-str';
  }
  // Initialize without credentials for emulator
  try {
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'rel-str' });
  } catch {}
}

function toEventDoc(obj) {
  return {
    eventType: String(obj.eventType || ''),
    phase: String(obj.phase || ''),
    runType: String(obj.runType || ''),
    runId: String(obj.runId || ''),
    status: String(obj.status || ''),
    publishTime: String(obj.publishTime || ''),
    pairsProcessed: Number(obj.pairsProcessed || 0),
    pairsFailed: Number(obj.pairsFailed || 0),
    intervalUsed: String(obj.intervalUsed || ''),
    isHeartbeat: !!obj.isHeartbeat,
    payloadStatus: String(obj.payloadStatus || ''),
    messageId: String(obj.messageId || ''),
    window: Number(obj.window || 0),
    startTime: admin.firestore.Timestamp.fromDate(new Date(obj.startTime)),
    endTime: admin.firestore.Timestamp.fromDate(new Date(obj.endTime)),
  };
}

async function main() {
  initAdmin();
  const db = admin.firestore();

  const docs = [
    {
      id: '2025-11-11-post-1635-16977768969968512',
      data: {
        eventType: 'ts-daily-post', phase: 'post', runType: 'ts-daily-post', runId: '2025-11-11-post-1635',
        status: 'completed', publishTime: '2025-11-11T21:35:07.483Z',
        pairsProcessed: 12, pairsFailed: 0, intervalUsed: 'DAILY', isHeartbeat: false, payloadStatus: 'begin',
        messageId: '16977768969968512', window: 365,
        startTime: '2025-11-11T21:00:11Z', endTime: '2025-11-11T21:35:22Z',
      },
    },
    {
      id: '2025-11-11-pre-1000-16863152850574845',
      data: {
        eventType: 'ts-daily-pre', phase: 'pre', runType: 'ts-daily-pre', runId: '2025-11-11-pre-1000',
        status: 'completed', publishTime: '2025-11-11T15:00:07.034Z',
        pairsProcessed: 12, pairsFailed: 0, intervalUsed: 'DAILY', isHeartbeat: false, payloadStatus: 'begin',
        messageId: '16863152850574845', window: 365,
        startTime: '2025-11-11T15:00:11Z', endTime: '2025-11-11T15:00:53Z',
      },
    },
    {
      id: '2025-11-11-pre-1500-16866780964092323',
      data: {
        eventType: 'ts-daily-pre', phase: 'pre', runType: 'ts-daily-pre', runId: '2025-11-11-pre-1500',
        status: 'completed', publishTime: '2025-11-11T20:00:06.186Z',
        pairsProcessed: 12, pairsFailed: 0, intervalUsed: 'DAILY', isHeartbeat: false, payloadStatus: 'begin',
        messageId: '16866780964092323', window: 365,
        startTime: '2025-11-11T20:00:09Z', endTime: '2025-11-11T20:00:52Z',
      },
    },
  ];

  let writes = 0;
  for (const d of docs) {
    const ref = db.collection('partner-events').doc(d.id);
    await ref.set(toEventDoc(d.data), { merge: true });
    writes++;
    console.log('Seeded partner-event', d.id);
  }
  console.log('Done. Seeded', writes, 'partner-events.');
}

main().catch((e) => {
  console.error('Seed failed', e);
  process.exit(1);
});
