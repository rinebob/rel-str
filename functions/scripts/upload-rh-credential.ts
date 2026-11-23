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
 *   npx tsx scripts/upload-rh-credential.ts <bundle-path> [--replace] [--force] [--keep-source]
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
  sealLocalSourceIfCopied,
  uploadCredentialBundle,
} from '../src/rh-agent-mcp/auth/upload-credential-bundle';
import {
  createLocalCredentialRepository,
  LocalCredentialStoreUnavailableError,
} from '../src/rh-agent-mcp/auth/local-credential-repository';

const KNOWN_FLAGS = new Set(['--replace', '--keep-source', '--force']);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknownFlag = args.find((a) => a.startsWith('--') && !KNOWN_FLAGS.has(a));
  const bundlePath = args.find((a) => !a.startsWith('--'));
  const replace = args.includes('--replace');

  if (unknownFlag || !bundlePath) {
    console.error(
      'Usage: npx tsx scripts/upload-rh-credential.ts <bundle-path> [--replace] [--force] [--keep-source]',
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
  const evidence = await uploadCredentialBundle(repository, bundle, {
    replace,
    force: args.includes('--force'),
  });
  if (replace && evidence.revision === 1) {
    console.warn('WARN: --replace found no existing doc — seeded at revision 1');
  }
  console.log('uploaded_credential', evidence);

  // Seal the lineage fork (#1658): if the local DPAPI store holds the same
  // grant that was just uploaded, both stores would race the same refresh
  // token — delete the local copy so the grant lives only in the prod store.
  if (args.includes('--keep-source')) {
    console.warn(
      'WARN: --keep-source set — if the local copy holds the same grant, ' +
      'two stores now race one refresh-token lineage; the first rotation ' +
      'orphans the other. Only use this for distinct local grants.',
    );
  } else {
    try {
      const seal = await sealLocalSourceIfCopied(createLocalCredentialRepository(), bundle);
      if (seal.warning) {
        console.warn(`WARN: ${seal.warning}`);
      }
      if (seal.reason === 'stale_export') {
        console.error(
          'FAIL: the uploaded bundle was a stale copy of the local lineage — ' +
          'production holds an already-rotated refresh token. Re-export the ' +
          'current local bundle and re-upload with --replace before any ' +
          'production refresh runs.',
        );
        process.exit(1);
      }
      if (seal.reason === 'rotated_during_seal') {
        console.error(
          'FAIL: the local grant rotated while the seal was pending — ' +
          'nothing was deleted, but production may now hold an ' +
          'already-rotated refresh token. Re-export the current local ' +
          'bundle and re-upload with --replace before any production ' +
          'refresh runs.',
        );
        process.exit(1);
      }
      if (seal.sealed) {
        console.log(
          'sealed_local_source: local DPAPI copy deleted — this grant now lives only in the prod store. ' +
          'Re-run the OAuth bootstrap to mint an independent local grant.',
        );
      } else {
        console.log(`local_source_intact: ${seal.reason}`);
      }
    } catch (error) {
      if (error instanceof LocalCredentialStoreUnavailableError) {
        console.log('local_source_intact: local DPAPI store unavailable on this machine');
      } else {
        throw error;
      }
    }
  }
  console.log(
    `Done — delete ${bundlePath} now; it contains live tokens.`,
  );
  process.exit(0); // admin SDK holds an open gRPC channel — exit explicitly
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exit(1);
});
