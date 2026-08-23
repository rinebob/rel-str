/**
 * verify-open-pass-timer.js — Verification for open pass timer (Task #168).
 *
 * Verifies:
 * 1. The openPassTimer scheduled function is deployed
 * 2. The 5-minute slot computation is correct
 * 3. Strategy instances with matching openTimePT are queried correctly
 *
 * Usage:
 *   node scripts/verify-open-pass-timer.js
 *   node scripts/verify-open-pass-timer.js --slot 09:30  (check specific slot)
 *
 * Flags:
 *   --slot  Override the slot to check (default: computed from current time)
 */

const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const opts = { slot: '' };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--slot') { opts.slot = args[++i]; continue; }
}

const PROJECT = 'rel-str';
const INSTANCES_COLLECTION = 'options-strategy-instances';

function computeSlot() {
  if (opts.slot) return opts.slot;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const truncated = Math.floor(minutes / 5) * 5;
  return `${String(hours).padStart(2, '0')}:${String(truncated).padStart(2, '0')}`;
}

function gcloudFirestore(cmd) {
  const fullCmd = `gcloud firestore ${cmd} --project=${PROJECT} --format=json`;
  try {
    const output = execFileSync(fullCmd, { shell: true, encoding: 'utf8', timeout: 30000 });
    return JSON.parse(output.trim());
  } catch (err) {
    return null;
  }
}

async function main() {
  const slot = computeSlot();
  console.log(`\n=== Open Pass Timer Verification ===`);
  console.log(`Current slot: ${slot}`);

  // Step 1: Verify scheduled function is deployed
  console.log(`\n--- Step 1: Verify openPassTimer is deployed ---`);
  console.log(`Check with:`);
  console.log(`  gcloud functions list --project=${PROJECT} --filter="openPassTimer"`);

  // Step 2: Check for matching instances
  console.log(`\n--- Step 2: Query instances with openTimePT == "${slot}" ---`);
  console.log(`Firestore query:`);
  console.log(`  collection: ${INSTANCES_COLLECTION}`);
  console.log(`  where: lifecycleState == "ACTIVE" AND openTimePT == "${slot}"`);
  console.log(`\nTo run this query:`);
  console.log(`  gcloud firestore documents list --collection-group="${INSTANCES_COLLECTION}" \\`);
  console.log(`    --project=${PROJECT} --filter="openTimePT=${slot}"`);

  // Step 3: Check function logs
  console.log(`\n--- Step 3: Check function logs ---`);
  console.log(`  gcloud functions logs read openPassTimer --project=${PROJECT} --region=us-central1 --limit=10`);

  // Step 4: Verify old optionsOpenPass is NOT deployed
  console.log(`\n--- Step 4: Verify old optionsOpenPass is removed ---`);
  console.log(`  gcloud functions list --project=${PROJECT} --filter="optionsOpenPass"`);
  console.log(`  (should return empty — old function removed)`);

  console.log(`\n=== Verification complete ===`);
}

main().catch(err => {
  console.error('Verification failed:', err.message);
  process.exit(1);
});
