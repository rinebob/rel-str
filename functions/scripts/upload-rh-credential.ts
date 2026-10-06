/**
 * Seeds the production RH credential doc (rh-agent-credentials/bundle) from a
 * portable bundle file produced by export-credential-bundle.ts (Topic #657,
 * task #806).
 *
 * Requires:
 *   - ADC (`gcloud auth application-default login`) as a principal holding
 *     roles/cloudkms.cryptoKeyEncrypterDecrypter on the credentials key
 *   - RH_CREDENTIAL_KEY_NAME env var
 *   - Firestore access to the rh-agent-credentials collection (admin SDK
 *     bypasses the client-side deny rule)
 *
 * Default mode is seed: refuses to overwrite an existing doc
 * (CredentialRevisionConflictError). `--replace` re-seeds after
 * reauthorization — CAS-guarded on the current revision.
 *
 * Prints structural evidence only — token values are never logged.
 *
 * Usage:
 *   cd functions
 *   $env:RH_CREDENTIAL_KEY_NAME="projects/<p>/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials"
 *   npx tsx scripts/upload-rh-credential.ts <bundle-path> [--replace]
 */
import { db } from '../src/firebase-admin-init';
import { createKmsCipherFromEnv } from '../src/rh-agent-mcp/auth/kms-cipher';
import {
  FirestoreDocStore,
  KmsFirestoreCredentialRepository,
  TransactionalCredentialDocumentBackend,
} from '../src/rh-agent-mcp/auth/kms-firestore-credential-repository';
import {
  readBundleFile,
  uploadCredentialBundle,
} from '../src/rh-agent-mcp/auth/upload-credential-bundle';

const KNOWN_FLAGS = new Set(['--replace']);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknownFlag = args.find((a) => a.startsWith('--') && !KNOWN_FLAGS.has(a));
  const bundlePath = args.find((a) => !a.startsWith('--'));
  const replace = args.includes('--replace');

  if (unknownFlag || !bundlePath) {
    console.error(
      'Usage: npx tsx scripts/upload-rh-credential.ts <bundle-path> [--replace]',
    );
    process.exit(2);
  }
  if (!process.env.RH_CREDENTIAL_KEY_NAME) {
    console.error('RH_CREDENTIAL_KEY_NAME is not set — provisioned in task #805.');
    process.exit(2);
  }

  const repository = new KmsFirestoreCredentialRepository(
    new TransactionalCredentialDocumentBackend(new FirestoreDocStore(db)),
    createKmsCipherFromEnv(),
  );

  const bundle = await readBundleFile(bundlePath);
  const evidence = await uploadCredentialBundle(repository, bundle, { replace });
  if (replace && evidence.revision === 1) {
    console.warn('WARN: --replace found no existing doc — seeded at revision 1');
  }
  console.log('uploaded_credential', evidence);
  console.log(
    `Done — delete ${bundlePath} now; it contains live tokens.`,
  );
  process.exit(0); // admin SDK holds an open gRPC channel — exit explicitly
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exit(1);
});
