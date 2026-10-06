/**
 * Verifies the KMS + Firestore credential repository (Topic #657, task #804) against the
 * REAL environment — no mocks:
 *   1. KmsCipher encrypt/decrypt round-trip against the real Cloud KMS key
 *   2. TransactionalCredentialDocumentBackend CAS: store → conflict → retry
 *   3. KmsFirestoreCredentialRepository full path: ciphertext-only doc,
 *      load round-trip, InvalidCredentialBundleError on a malformed doc
 *
 * Writes to a scratch doc (rh-agent-credentials/verify-scratch) — never the
 * real `bundle` doc. Requires ADC + a provisioned KMS key (task #805).
 *
 * Usage:
 *   cd functions
 *   $env:RH_CREDENTIAL_KEY_NAME="projects/<p>/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials"
 *   npx tsx scripts/verify/rh-mcp-kms-repository-804.ts [--doc <firestore-doc-path>]
 */
import { db } from '../../src/firebase-admin-init';
import { createKmsCipherFromEnv } from '../../src/rh-agent-mcp/auth/kms-cipher';
import {
  FirestoreDocStore,
  TransactionalCredentialDocumentBackend,
  KmsFirestoreCredentialRepository,
  RH_CREDENTIAL_DOC_PATH,
} from '../../src/rh-agent-mcp/auth/kms-firestore-credential-repository';
import type { RobinhoodCredentialBundle } from '../../src/rh-agent-mcp/contracts/authentication';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
}

function syntheticBundle(revision: number, tag: string): RobinhoodCredentialBundle {
  return {
    schemaVersion: 1,
    revision,
    tokens: {
      access_token: `synthetic-access-${tag}`,
      refresh_token: `synthetic-refresh-${tag}`,
      expires_in: 3600,
      token_type: 'Bearer',
    },
    clientInformation: { client_id: 'synthetic-client-id' },
    discoveryState: { authorizationServerUrl: 'https://synthetic.invalid' },
  };
}

async function main(): Promise<void> {
  const docIdx = process.argv.indexOf('--doc');
  const docPath = docIdx > -1 ? process.argv[docIdx + 1] : 'rh-agent-credentials/verify-scratch';
  if (docPath === RH_CREDENTIAL_DOC_PATH) {
    console.error('Refusing to run against the live bundle doc — use a scratch path.');
    process.exit(2);
  }

  const keyName = process.env.RH_CREDENTIAL_KEY_NAME;
  if (!keyName) {
    console.error('FAIL: RH_CREDENTIAL_KEY_NAME is not set — provision the key (task #805) first.');
    process.exit(2);
  }

  console.log(`--- KmsCipher (real KMS key) ---`);
  const cipher = createKmsCipherFromEnv();
  const plaintext = JSON.stringify(syntheticBundle(1, 'kms-round-trip'));
  const ciphertext = await cipher.encrypt(plaintext);
  check('encrypt returns base64 ciphertext', /^[A-Za-z0-9+/=]+$/.test(ciphertext));
  check('ciphertext carries no plaintext', !ciphertext.includes('synthetic-access'));
  check('decrypt round-trips', (await cipher.decrypt(ciphertext)) === plaintext);

  console.log(`\n--- KmsFirestoreCredentialRepository (real Firestore, ${docPath}) ---`);
  const backend = new TransactionalCredentialDocumentBackend(
    new FirestoreDocStore(db),
    docPath,
  );
  const repository = new KmsFirestoreCredentialRepository(backend, cipher);
  await repository.delete(); // clean slate

  check('load on empty doc -> null', (await repository.load()) === null);

  const first = await repository.store(syntheticBundle(0, 'one'), null);
  check('initial store -> revision 1', first.revision === 1);

  const snap = await db.doc(docPath).get();
  const persisted = snap.data() as { ciphertext?: string; revision?: number } | undefined;
  check('doc contains ciphertext + revision', !!persisted?.ciphertext && persisted.revision === 1);
  check('doc carries only ciphertext/revision/updatedAt',
    !!persisted &&
    Object.keys(persisted).sort().join(',') === 'ciphertext,revision,updatedAt');
  check('doc ciphertext has no token material', !persisted?.ciphertext?.includes('synthetic-access-one'));
  check('load round-trips the bundle',
    (await repository.load())?.tokens.access_token === 'synthetic-access-one');

  let conflict = false;
  try {
    await repository.store(syntheticBundle(0, 'stale'), null);
  } catch (e) {
    conflict = (e as Error).name === 'CredentialRevisionConflictError';
  }
  check('stale-revision store throws CredentialRevisionConflictError', conflict);

  const second = await repository.store(syntheticBundle(first.revision, 'two'), first.revision);
  check('correct expectedRevision store -> revision 2', second.revision === 2);

  // Valid KMS ciphertext wrapping an invalid bundle — exercises the
  // parseBundle fail-closed path (not just any thrown error).
  const badCiphertext = await cipher.encrypt(JSON.stringify({ nope: true }));
  await db.doc(docPath).set({ ciphertext: badCiphertext, revision: 9 });
  let invalidBundle = false;
  try {
    await repository.load();
  } catch (e) {
    invalidBundle = (e as Error).name === 'InvalidCredentialBundleError';
  }
  check('malformed doc load fails closed (InvalidCredentialBundleError)', invalidBundle);

  await repository.delete();
  check('delete removes the doc', !(await db.doc(docPath).get()).exists);

  console.log(failures === 0 ? '\n=== PASS ===' : `\n=== ${failures} FAILURES ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('verify script error:', e instanceof Error ? e.message : e);
  process.exit(2);
});
