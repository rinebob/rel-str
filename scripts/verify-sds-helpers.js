/**
 * Firestore verification helpers for verify-sds.js.
 * Extracted to keep verify-sds.js under 300 lines.
 */

const SDS_RUNS_COLLECTION = 'symbol-data-sync-runs';
const SDS_SEQUENCES_COLLECTION = 'symbol-data-sync-sequences';
const SYMBOL_DATA_COLLECTION = 'symbol-data';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyRunDoc(db, runId) {
  const ref = db.collection(SDS_RUNS_COLLECTION).doc(runId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return snap.data();
}

async function verifySequenceDoc(db, marketDate, sequence) {
  const seqId = `${marketDate}-POST-${sequence}`;
  const ref = db.collection(SDS_SEQUENCES_COLLECTION).doc(seqId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return { id: seqId, ...snap.data() };
}

async function verifySymbolData(db, symbol, interval) {
  const rootRef = db.collection(SYMBOL_DATA_COLLECTION).doc(symbol);
  const rootSnap = await rootRef.get();
  if (!rootSnap.exists) return null;
  const root = rootSnap.data();
  const result = { root, shards: {} };

  if (interval === 'DAILY') {
    const year = new Date().getFullYear();
    const shardSnap = await rootRef.collection('daily').doc(String(year)).get();
    if (shardSnap.exists) result.shards.daily = shardSnap.data();
  } else if (interval === 'WEEKLY') {
    const shardSnap = await rootRef.collection('weekly').doc('all').get();
    if (shardSnap.exists) result.shards.weekly = shardSnap.data();
  } else if (interval === 'MONTHLY') {
    const shardSnap = await rootRef.collection('monthly').doc('all').get();
    if (shardSnap.exists) result.shards.monthly = shardSnap.data();
  } else if (interval === 'intraday') {
    const snap = await rootRef.collection('intraday').doc('latest').get();
    if (snap.exists) result.shards.intraday = snap.data();
  }

  return result;
}

async function pollForResult(db, runId, marketDate, phase, sequence, interval, waitSeconds, symbolsArg) {
  const deadline = Date.now() + waitSeconds * 1000;
  let elapsed = 0;

  console.log(`Polling for run doc (max ${waitSeconds}s)...`);
  console.log('');

  while (Date.now() < deadline) {
    const runDoc = await verifyRunDoc(db, runId);
    if (runDoc) {
      console.log(`✓ Run doc found after ${elapsed}s`);
      console.log(`  status:         ${runDoc.status}`);
      console.log(`  totalSymbols:   ${runDoc.totalSymbols}`);
      console.log(`  processedCount: ${runDoc.processedCount}`);
      console.log(`  successCount:   ${runDoc.successCount ?? 'n/a'}`);
      console.log(`  failedCount:    ${runDoc.failedCount ?? 'n/a'}`);
      console.log(`  interval:       ${runDoc.interval}`);
      console.log(`  sequence:       ${runDoc.sequence ?? 'n/a'}`);
      console.log('');

      if (phase === 'post') {
        const seqDoc = await verifySequenceDoc(db, marketDate, sequence);
        if (seqDoc) {
          console.log(`✓ Sequence doc found: ${seqDoc.id}`);
          console.log(`  intervalRunIds: ${JSON.stringify(seqDoc.intervalRunIds)}`);
          console.log(`  status:         ${seqDoc.status}`);
          console.log('');
        } else {
          console.log(`✗ Sequence doc not found`);
          console.log('');
        }
      }

      const sampleSymbol = phase === 'pre' ? 'AAPL' :
        (sequence === 'A' ? 'GOOGL' : (symbolsArg ? symbolsArg.split(',')[0].trim().toUpperCase() : 'AAPL'));

      console.log(`Checking symbol-data for ${sampleSymbol}...`);
      const symData = await verifySymbolData(db, sampleSymbol, interval.toLowerCase());
      if (symData) {
        if (symData.shards.daily) console.log(`✓ Daily shard: ${symData.shards.daily.bars?.length ?? 0} bars`);
        if (symData.shards.weekly) console.log(`✓ Weekly doc: ${symData.shards.weekly.bars?.length ?? 0} bars`);
        if (symData.shards.monthly) console.log(`✓ Monthly doc: ${symData.shards.monthly.bars?.length ?? 0} bars`);
        if (symData.shards.intraday) console.log(`✓ Intraday doc: ip=${symData.shards.intraday.ip}, it=${symData.shards.intraday.it}`);
        if (symData.root?.currentPrice) {
          console.log(`✓ currentPrice: ${JSON.stringify(symData.root.currentPrice)}`);
        } else if (interval === 'DAILY' || interval === 'intraday') {
          console.log(`✗ currentPrice missing (expected for ${interval})`);
        }
      } else {
        console.log(`✗ No symbol-data found for ${sampleSymbol}`);
      }

      if (runDoc.status === 'completed' || runDoc.status === 'failed' || runDoc.status === 'completed_with_errors') {
        console.log('');
        console.log(`✓ Run reached terminal status: ${runDoc.status}`);
        return true;
      }

      // #166 doesn't implement completion check (#167 does) — treat all processed as terminal
      if (runDoc.processedCount >= runDoc.totalSymbols && runDoc.totalSymbols > 0) {
        console.log('');
        console.log(`✓ All symbols processed (${runDoc.processedCount}/${runDoc.totalSymbols}) — status still '${runDoc.status}' (completion logic is Task #167)`);
        return true;
      }
      console.log(`  (still processing, polling...)`);
    } else {
      process.stdout.write('.');
    }

    await sleep(3000);
    elapsed += 3;
  }

  console.log('');
  console.log(`✗ Timed out after ${waitSeconds}s waiting for run doc`);
  return false;
}

module.exports = { pollForResult };
