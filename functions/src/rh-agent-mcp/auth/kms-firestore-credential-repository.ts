/**
 * Production credential repository: KMS ciphertext in a Firestore doc with
 * transactional revision compare-and-swap.
 *
 * Doc: `rh-agent-credentials/bundle` = { ciphertext (base64), revision,
 * updatedAt }. Only ciphertext + metadata ever touch Firestore — decryption
 * requires the KMS grant, which the document alone does not confer.
 *
 * `CredentialDocStore` is the Firestore port — the real CAS transaction body
 * is unit-tested offline against an in-memory store, not a mocked admin SDK.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type {
  CredentialCipher,
  RobinhoodCredentialRepository,
} from './credential-repository';
import {
  CredentialRevisionConflictError,
  MalformedCredentialDocError,
} from './credential-repository';
import { parseBundle } from './credential-bundle-codec';
import type { RobinhoodCredentialBundle } from '../contracts/authentication';

export const RH_CREDENTIAL_DOC_PATH = 'rh-agent-credentials/bundle';

export interface StoredCredentialDoc {
  ciphertext: string;
  revision: number;
}

/**
 * Persistence port for the encrypted credential doc. The store's `store` must
 * apply the write atomically with the revision check and throw
 * CredentialRevisionConflictError when the stored revision has moved past
 * `expectedRevision`.
 */
export interface CredentialDocumentBackend {
  load(): Promise<StoredCredentialDoc | null>;
  store(
    ciphertext: string,
    revision: number,
    expectedRevision: number | null,
  ): Promise<void>;
  delete(): Promise<void>;
}

/** Minimal doc surface the CAS transaction needs — faked without casts. */
export interface CredentialDocSnapshot {
  readonly exists: boolean;
  data(): StoredCredentialDoc | undefined;
}

export interface CredentialDocTransaction {
  get(path: string): Promise<CredentialDocSnapshot>;
  set(path: string, data: Record<string, unknown>): void;
}

/** CRUD + transaction surface over credential docs. */
export interface CredentialDocStore {
  get(path: string): Promise<CredentialDocSnapshot>;
  delete(path: string): Promise<void>;
  runTransaction<T>(
    updateFunction: (txn: CredentialDocTransaction) => Promise<T>,
  ): Promise<T>;
}

export class KmsFirestoreCredentialRepository implements RobinhoodCredentialRepository {
  constructor(
    private readonly backend: CredentialDocumentBackend,
    private readonly cipher: CredentialCipher,
  ) {}

  async load(): Promise<RobinhoodCredentialBundle | null> {
    const doc = await this.backend.load();
    if (!doc) {
      return null;
    }
    return parseBundle(await this.cipher.decrypt(doc.ciphertext));
  }

  async store(
    credential: RobinhoodCredentialBundle,
    expectedRevision: number | null,
  ): Promise<RobinhoodCredentialBundle> {
    const stored: RobinhoodCredentialBundle = {
      ...credential,
      schemaVersion: 1,
      revision: (expectedRevision ?? 0) + 1,
    };
    const ciphertext = await this.cipher.encrypt(JSON.stringify(stored));
    await this.backend.store(ciphertext, stored.revision, expectedRevision);
    return stored;
  }

  async delete(): Promise<void> {
    await this.backend.delete();
  }
}

/** CredentialDocumentBackend over a doc store — revision CAS in one txn. */
export class TransactionalCredentialDocumentBackend implements CredentialDocumentBackend {
  constructor(
    private readonly docs: CredentialDocStore,
    private readonly docPath: string = RH_CREDENTIAL_DOC_PATH,
  ) {}

  async load(): Promise<StoredCredentialDoc | null> {
    const snapshot = await this.docs.get(this.docPath);
    if (!snapshot.exists) {
      return null;
    }
    const data = snapshot.data();
    if (!data || typeof data.ciphertext !== 'string' || typeof data.revision !== 'number') {
      throw new MalformedCredentialDocError(`Malformed credential doc at ${this.docPath}`);
    }
    return { ciphertext: data.ciphertext, revision: data.revision };
  }

  async store(
    ciphertext: string,
    revision: number,
    expectedRevision: number | null,
  ): Promise<void> {
    await this.docs.runTransaction(async (txn) => {
      const snapshot = await txn.get(this.docPath);
      const current = snapshot.exists ? snapshot.data()?.revision ?? null : null;
      if (current !== expectedRevision) {
        throw new CredentialRevisionConflictError();
      }
      txn.set(this.docPath, {
        ciphertext,
        revision,
        updatedAt: new Date(),
      });
    });
  }

  async delete(): Promise<void> {
    await this.docs.delete(this.docPath);
  }
}

/** firebase-admin Firestore adapter for CredentialDocStore. */
export class FirestoreDocStore implements CredentialDocStore {
  constructor(private readonly db: Firestore) {}

  async get(path: string): Promise<CredentialDocSnapshot> {
    const snapshot = await this.db.doc(path).get();
    return {
      exists: snapshot.exists,
      data: () => snapshot.data() as StoredCredentialDoc | undefined,
    };
  }

  async delete(path: string): Promise<void> {
    await this.db.doc(path).delete();
  }

  runTransaction<T>(
    updateFunction: (txn: CredentialDocTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.runTransaction((t) =>
      updateFunction({
        get: async (path) => {
          const snapshot = await t.get(this.db.doc(path));
          return {
            exists: snapshot.exists,
            data: () => snapshot.data() as StoredCredentialDoc | undefined,
          };
        },
        set: (path, data) => {
          t.set(this.db.doc(path), data);
        },
      }),
    );
  }
}
