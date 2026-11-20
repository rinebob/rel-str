/**
 * @topic #657 — RH-MCP, Thread #795 (Production RH API)
 * @task #1639 — Rewire prod RH passes to KmsFirestoreCredentialRepository
 *
 * Single construction site for the production credential repository —
 * KMS cipher + `rh-agent-credentials/bundle` CAS doc. Every deployed
 * consumer (rhApi, scheduled passes, callables, canary) must share this
 * repo so a Robinhood refresh-token rotation persists durably instead of
 * surviving only in the rotating instance's memory
 * (EnvCredentialRepository's failure mode — the recurring
 * REAUTHORIZATION_REQUIRED incident this task fixes).
 *
 * RH_CREDENTIAL_KEY_NAME ships in functions/.env, so every function in
 * this directory resolves the key name without extra config.
 */
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type {
  CredentialCipher,
  RobinhoodCredentialRepository,
} from './credential-repository';
import { createKmsCipherFromEnv } from './kms-cipher';
import {
  FirestoreDocStore,
  KmsFirestoreCredentialRepository,
  TransactionalCredentialDocumentBackend,
} from './kms-firestore-credential-repository';

export interface ProductionCredentialRepositoryDeps {
  db?: Firestore;
  cipher?: CredentialCipher;
}

/** Shared across calls on a warm instance — the repo is stateless (every
 *  load()/store() hits Firestore), and sharing avoids minting a
 *  KeyManagementServiceClient (a gRPC channel) per function invocation. */
let sharedRepository: RobinhoodCredentialRepository | undefined;

export function createKmsCredentialRepository(
  deps: ProductionCredentialRepositoryDeps = {},
): RobinhoodCredentialRepository {
  if (deps.db === undefined && deps.cipher === undefined) {
    if (!sharedRepository) {
      // Cipher first — a missing key name must surface KmsUnavailableError,
      // not a getFirestore no-app error.
      const cipher = createKmsCipherFromEnv();
      sharedRepository = build(getFirestore(), cipher);
    }
    return sharedRepository;
  }
  return build(
    deps.db ?? getFirestore(),
    deps.cipher ?? createKmsCipherFromEnv(),
  );
}

function build(
  db: Firestore,
  cipher: CredentialCipher,
): RobinhoodCredentialRepository {
  return new KmsFirestoreCredentialRepository(
    new TransactionalCredentialDocumentBackend(new FirestoreDocStore(db)),
    cipher,
  );
}
