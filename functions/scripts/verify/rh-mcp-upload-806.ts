/**
 * Verifies the #806 credential-upload flow against the REAL environment —
 * no mocks: readBundleFile parses a portable bundle file, then
 * uploadCredentialBundle seeds/replaces through KmsFirestoreCredentialRepository
 * (real KMS cipher + real Firestore CAS) with a reload round-trip proof.
 *
 * Writes to a scratch doc (rh-agent-credentials/verify-scratch) — never the
 * real `bundle` doc. Requires ADC + a provisioned KMS key (task #805).
 *
 * Usage:
 *   cd functions
 *   $env:RH_CREDENTIAL_KEY_NAME="projects/<p>/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials"
 *   npx tsx scripts/verify/rh-mcp-upload-806.ts [--bundle <portable-bundle.json>] [--doc <firestore-doc-path>]
 *
 * `--bundle` defaults to the committed synthetic fixture
 * (`tests/functions/fixtures/rh-credential-bundle-valid.json`) — a real export
 * works too, but this script stores whatever it is given.
 */
import { resolve } from 'node:path';
import { db } from '../../src/firebase-admin-init';
import { createKmsCipherFromEnv } from '../../src/rh-agent-mcp/auth/kms-cipher';
import {
  FirestoreDocStore,
  TransactionalCredentialDocumentBackend,
  KmsFirestoreCredentialRepository,
  RH_CREDENTIAL_DOC_PATH,
} from '../../src/rh-agent-mcp/auth/kms-firestore-credential-repository';
import {
  readBundleFile,
  uploadCredentialBundle,
} from '../../src/rh-agent-mcp/auth/upload-credential-bundle';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  const value = idx > -1 ? process.argv[idx + 1] : undefined;
  return value !== undefined && !value.startsWith('--') ? value : undefined;
}

const KNOWN_FLAGS = new Set(['--bundle', '--doc']);

async function main(): Promise<void> {
  const unknownFlag = process.argv
    .slice(2)
    .find((a) => a.startsWith('--') && !KNOWN_FLAGS.has(a));
  if (unknownFlag) {
    console.error(`Unknown flag: ${unknownFlag}`);
    process.exit(2);
  }
  const docPath = argValue('--doc') ?? 'rh-agent-credentials/verify-scratch';
  // Default: committed synthetic fixture (relative to the functions/ cwd).
  const bundlePath = resolve(
    argValue('--bundle') ??
      '../tests/functions/fixtures/rh-credential-bundle-valid.json',
  );
  if (docPath === RH_CREDENTIAL_DOC_PATH) {
    console.error('Refusing to run against the live bundle doc — use a scratch path.');
    process.exit(2);
  }
  if (!process.env.RH_CREDENTIAL_KEY_NAME) {
    console.error('FAIL: RH_CREDENTIAL_KEY_NAME is not set — provision the key (task #805) first.');
    process.exit(2);
  }

  const cipher = createKmsCipherFromEnv();
  const repository = new KmsFirestoreCredentialRepository(
    new TransactionalCredentialDocumentBackend(new FirestoreDocStore(db), docPath),
    cipher,
  );
  await repository.delete(); // clean slate

  console.log(`--- readBundleFile ---`);
  const bundle = await readBundleFile(bundlePath);
  check('bundle file parses (schemaVersion 1)', bundle.schemaVersion === 1);
  check('bundle carries token material', Boolean(bundle.tokens.access_token));

  console.log(`\n--- uploadCredentialBundle: seed (real KMS + Firestore, ${docPath}) ---`);
  const seed = await uploadCredentialBundle(repository, bundle);
  check('seed evidence revision 1', seed.revision === 1);
  check('seed evidence mode', seed.mode === 'seed');
  check('seed evidence proves reload', seed.reloadedEquivalent === true);
  check('evidence carries no token material',
    !JSON.stringify(seed).includes(bundle.tokens.access_token ?? '∅') &&
    !JSON.stringify(seed).includes(bundle.tokens.refresh_token ?? '∅'));

  const snap = await db.doc(docPath).get();
  const persisted = snap.data() as { ciphertext?: string; revision?: number } | undefined;
  check('doc is ciphertext-only', !!persisted &&
    Object.keys(persisted).sort().join(',') === 'ciphertext,revision,updatedAt');
  check('reload through repository returns the bundle',
    (await repository.load())?.tokens.access_token === bundle.tokens.access_token);

  console.log(`\n--- seed refusal + replace ---`);
  let conflict = false;
  try {
    await uploadCredentialBundle(repository, bundle);
  } catch (e) {
    conflict = (e as Error).name === 'CredentialRevisionConflictError';
  }
  check('second seed throws CredentialRevisionConflictError', conflict);

  const replaced = await uploadCredentialBundle(repository, bundle, { replace: true });
  check('replace -> revision 2', replaced.revision === 2 && replaced.mode === 'replace');

  await repository.delete();
  check('delete removes the scratch doc', !(await db.doc(docPath).get()).exists);

  console.log(failures === 0 ? '\n=== PASS ===' : `\n=== ${failures} FAILURES ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(
    'verify script error:',
    e instanceof Error ? (e.message ? `${e.name}: ${e.message}` : e.name) : e,
  );
  process.exit(2);
});
