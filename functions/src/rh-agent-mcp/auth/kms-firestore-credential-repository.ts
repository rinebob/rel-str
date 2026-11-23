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
  RefreshLease,
  RefreshLeasePort,
  RobinhoodCredentialRepository,
} from './credential-repository';
import {
  CredentialRevisionConflictError,
  MalformedCredentialDocError,
} from './credential-repository';
import { parseBundle } from './credential-bundle-codec';
import type { RobinhoodCredentialBundle } from '../contracts/authentication';

export const RH_CREDENTIAL_DOC_PATH = 'rh-agent-credentials/bundle';
/** Single refresh slot — serializes the token POST across deployed
 *  instances. TTL'd so a crashed holder's lease expires on its own. */
export const RH_REFRESH_LEASE_DOC_PATH = 'rh-agent-credentials/refresh-lease';

/** Lease-expiry reads tolerate this much writer-behind clock skew — see
 *  the comment in `acquire`. */
const CLOCK_SKEW_GRACE_MS = 1_000;

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
  /** `expectedRevision` makes the delete a compare-and-delete in one txn —
   *  a landing store() turns it into CredentialRevisionConflictError rather
   *  than losing a grant that rotated under the caller (issue #1658). */
  delete(expectedRevision?: number): Promise<void>;
}

/** Minimal doc surface the CAS transaction needs — faked without casts.
 *  `data()` is untyped: credential docs and the lease doc share the store. */
export interface CredentialDocSnapshot {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface CredentialDocTransaction {
  get(path: string): Promise<CredentialDocSnapshot>;
  set(path: string, data: Record<string, unknown>): void;
  delete(path: string): void;
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
  readonly refreshLease?: RefreshLeasePort;

  constructor(
    private readonly backend: CredentialDocumentBackend,
    private readonly cipher: CredentialCipher,
  ) {
    // Narrow port literal — callers get acquire/release/currentRevision,
    // not the whole backend (same shape as the file repos' lease).
    this.refreshLease = isRefreshLeaseBackend(backend)
      ? {
          currentRevision: () => backend.currentRevision(),
          acquire: (holderId, ttlMs) => backend.acquire(holderId, ttlMs),
          release: (lease) => backend.release(lease),
        }
      : undefined;
  }

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

  async delete(expectedRevision?: number): Promise<void> {
    await this.backend.delete(expectedRevision);
  }
}

/** Lease doc shape — `{holderId, expiresAtEpochMs}`. */
export interface RefreshLeaseDoc {
  holderId: string;
  expiresAtEpochMs: number;
}

/** CredentialDocumentBackend over a doc store — revision CAS in one txn.
 *  Also carries the RefreshLeasePort over `rh-agent-credentials/refresh-lease`. */
export class TransactionalCredentialDocumentBackend implements CredentialDocumentBackend, RefreshLeasePort {
  constructor(
    private readonly docs: CredentialDocStore,
    private readonly docPath: string = RH_CREDENTIAL_DOC_PATH,
    private readonly leaseDocPath: string = RH_REFRESH_LEASE_DOC_PATH,
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

  async delete(expectedRevision?: number): Promise<void> {
    if (expectedRevision === undefined) {
      await this.docs.delete(this.docPath);
      return;
    }
    await this.docs.runTransaction(async (txn) => {
      const snapshot = await txn.get(this.docPath);
      const current = snapshot.exists ? (snapshot.data()?.revision ?? null) : null;
      if (current !== expectedRevision) {
        throw new CredentialRevisionConflictError();
      }
      txn.delete(this.docPath);
    });
  }

  async currentRevision(): Promise<number | null> {
    const doc = await this.load();
    return doc?.revision ?? null;
  }

  async acquire(holderId: string, ttlMs: number): Promise<RefreshLease | null> {
    let acquired = false;
    await this.docs.runTransaction(async (txn) => {
      // The store may re-invoke this body on contention — recompute per attempt
      // so a retry seeing a live holder doesn't report a lease it never wrote.
      acquired = false;
      const nowMs = Date.now();
      const snapshot = await txn.get(this.leaseDocPath);
      const current: Partial<RefreshLeaseDoc> | undefined = snapshot.exists
        ? snapshot.data()
        : undefined;
      const liveExpiry =
        typeof current?.expiresAtEpochMs === 'number' ? current.expiresAtEpochMs : 0;
      // Expiry is written on the acquirer's clock and read on ours —
      // instances are NTP-synced, but writer-behind skew would shrink the
      // effective TTL and allow takeover during a live POST. The grace
      // keeps the check conservative.
      if (liveExpiry + CLOCK_SKEW_GRACE_MS > nowMs) {
        return; // another live holder owns the slot
      }
      txn.set(this.leaseDocPath, {
        holderId,
        expiresAtEpochMs: nowMs + ttlMs,
      } satisfies RefreshLeaseDoc);
      acquired = true;
    });
    return acquired ? { holderId } : null;
  }

  async release(lease: RefreshLease): Promise<void> {
    await this.docs.runTransaction(async (txn) => {
      const snapshot = await txn.get(this.leaseDocPath);
      const current: Partial<RefreshLeaseDoc> | undefined = snapshot.exists
        ? snapshot.data()
        : undefined;
      if (current?.holderId === lease.holderId) {
        txn.delete(this.leaseDocPath);
      }
    });
  }
}

export function isRefreshLeaseBackend(
  backend: CredentialDocumentBackend,
): backend is CredentialDocumentBackend & RefreshLeasePort {
  const candidate = backend as Partial<RefreshLeasePort>;
  return (
    typeof candidate.acquire === 'function' &&
    typeof candidate.release === 'function' &&
    typeof candidate.currentRevision === 'function'
  );
}

/** firebase-admin Firestore adapter for CredentialDocStore. */
export class FirestoreDocStore implements CredentialDocStore {
  constructor(private readonly db: Firestore) {}

  async get(path: string): Promise<CredentialDocSnapshot> {
    const snapshot = await this.db.doc(path).get();
    return {
      exists: snapshot.exists,
      data: () => snapshot.data() as Record<string, unknown> | undefined,
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
            data: () => snapshot.data() as Record<string, unknown> | undefined,
          };
        },
        set: (path, data) => {
          t.set(this.db.doc(path), data);
        },
        delete: (path) => {
          t.delete(this.db.doc(path));
        },
      }),
    );
  }
}
