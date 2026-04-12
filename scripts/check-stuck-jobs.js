const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp({
  projectId: 'rel-str',
});

const db = admin.firestore();

async function checkStuckJobs(runId) {
  console.log(`\nChecking stuck jobs for run: ${runId}\n`);
  
  const jobsRef = db.collection(`system/rs-realtime-runs/runs/${runId}/jobs`);
  const snapshot = await jobsRef.get();
  
  const stuck = [];
  const summary = {
    total: snapshot.size,
    success: 0,
    permanentFailure: 0,
    pending: 0,
    inProgress: 0,
    transientFailure: 0,
  };
  
  snapshot.forEach(doc => {
    const data = doc.data();
    const status = data.status;
    
    if (status === 'SUCCESS') {
      summary.success++;
    } else if (status === 'PERMANENT_FAILURE') {
      summary.permanentFailure++;
    } else if (status === 'PENDING') {
      summary.pending++;
      stuck.push({
        id: doc.id,
        status,
        attempts: data.attempts || 0,
        createdAt: data.createdAt?.toDate?.() || null,
      });
    } else if (status === 'IN_PROGRESS') {
      summary.inProgress++;
      stuck.push({
        id: doc.id,
        status,
        attempts: data.attempts || 0,
        lastAttemptAt: data.lastAttemptAt?.toDate?.() || null,
      });
    } else if (status === 'TRANSIENT_FAILURE') {
      summary.transientFailure++;
      stuck.push({
        id: doc.id,
        status,
        attempts: data.attempts || 0,
        lastError: data.lastError,
        lastAttemptAt: data.lastAttemptAt?.toDate?.() || null,
      });
    }
  });
  
  console.log('Summary:');
  console.log(`  Total jobs:           ${summary.total}`);
  console.log(`  SUCCESS:              ${summary.success}`);
  console.log(`  PERMANENT_FAILURE:    ${summary.permanentFailure}`);
  console.log(`  PENDING:              ${summary.pending}`);
  console.log(`  IN_PROGRESS:          ${summary.inProgress}`);
  console.log(`  TRANSIENT_FAILURE:    ${summary.transientFailure}`);
  console.log(`  Stuck (non-terminal): ${stuck.length}`);
  
  if (stuck.length > 0) {
    console.log('\nStuck jobs:');
    stuck.forEach((job, idx) => {
      console.log(`\n${idx + 1}. ${job.id}`);
      console.log(`   Status: ${job.status}`);
      console.log(`   Attempts: ${job.attempts}`);
      if (job.lastError) {
        console.log(`   Error: ${job.lastError}`);
      }
      if (job.lastAttemptAt) {
        console.log(`   Last attempt: ${job.lastAttemptAt.toISOString()}`);
      }
      if (job.createdAt) {
        console.log(`   Created: ${job.createdAt.toISOString()}`);
      }
    });
  }
  
  process.exit(0);
}

const runId = process.argv[2] || '2026-03-10-TUE-B-WEEKLY-LIVE-POST-2100';
checkStuckJobs(runId).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
