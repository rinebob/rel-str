/**
 * Verifies the #1658 refresh-lease port against REAL Firestore — no mocks:
 *   1. currentRevision() reads the real `rh-agent-credentials/bundle`
 *      revision without decrypting (no KMS key needed)
 *   2. acquire/deny/release round-trip on a scratch lease doc —
 *      `rh-agent-credentials/verify-lease-scratch` — never the live
 *      `refresh-lease` doc
 *   3. holder fencing (a mismatched release cannot free the slot)
 *   4. expired-TTL takeover (crashed-holder recovery)
 *   5. the credential doc revision is untouched by lease ops
 *
 * Requires ADC only — the lease port never decrypts the credential doc.
 *
 * Usage:
 *   cd functions
 *   npx tsx scripts/verify/rh-mcp-refresh-lease-1658.ts
 */
import { db } from '../../src/firebase-admin-init';
import {
  FirestoreDocStore,
  TransactionalCredentialDocumentBackend,
  RH_CREDENTIAL_DOC_PATH,
} from '../../src/rh-agent-mcp/auth/kms-firestore-credential-repository';

const SCRATCH_LEASE_PATH = 'rh-agent-credentials/verify-lease-scratch';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  const docs = new FirestoreDocStore(db);
  const backend = new TransactionalCredentialDocumentBackend(
    docs,
    RH_CREDENTIAL_DOC_PATH, // real doc — read-only, for currentRevision
    SCRATCH_LEASE_PATH, // scratch lease — lease ops never touch the live slot
  );

  console.log('== currentRevision against the real bundle doc ==');
  const realDoc = await docs.get(RH_CREDENTIAL_DOC_PATH);
  const realRevision = realDoc.exists ? realDoc.data()?.revision ?? null : null;
  check('real bundle doc exists', realDoc.exists);
  check(
    'currentRevision() matches the stored doc revision',
    (await backend.currentRevision()) === realRevision,
    `doc=${realRevision}`,
  );

  try {
    console.log('== lease acquire / deny / release (scratch doc) ==');
    const revisionBefore = await backend.currentRevision();
    const a = await backend.acquire('verify-1658-holder-a', 60_000);
    check('first acquire grants the lease', a?.holderId === 'verify-1658-holder-a');
    check(
      'second acquire is denied while live-held',
      (await backend.acquire('verify-1658-holder-b', 60_000)) === null,
    );
    check(
      'foreign release is fenced — slot stays held',
      await backend
        .release({ holderId: 'intruder' })
        .then(async () => (await backend.acquire('verify-1658-holder-b', 60_000)) === null),
    );
    await backend.release(a!);
    const b = await backend.acquire('verify-1658-holder-b', 60_000);
    check('lease is takeable after the holder releases', b?.holderId === 'verify-1658-holder-b');
    await backend.release(b!);

    console.log('== expired-TTL takeover (crashed-holder recovery) ==');
    // Expired well past CLOCK_SKEW_GRACE_MS (1s) so the liveness check
    // treats the lease as dead even under write-read skew.
    const c = await backend.acquire('verify-1658-holder-c', -5_000);
    check('acquire with elapsed TTL writes a lease', c !== null);
    const d = await backend.acquire('verify-1658-holder-d', 60_000);
    check('expired lease is takeable by a new holder', d?.holderId === 'verify-1658-holder-d');
    if (d) {
      await backend.release(d);
    }

    console.log('== hygiene ==');
    check(
      'credential doc revision untouched by lease ops',
      (await backend.currentRevision()) === revisionBefore,
    );
  } finally {
    // A failed check must not strand a live scratch lease.
    await docs.delete(SCRATCH_LEASE_PATH).catch(() => undefined);
  }

  const scratch = await docs.get(SCRATCH_LEASE_PATH);
  check('scratch lease doc absent after cleanup', !scratch.exists);

  if (failures === 0) {
    console.log('\nAll checks passed.');
    process.exit(0);
  }
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exit(1);
});
