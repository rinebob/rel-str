import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import {
  createKmsCredentialRepository,
} from "../../functions/src/rh-agent-mcp/auth/production-credential-repository";
import {
  CredentialRevisionConflictError,
} from "../../functions/src/rh-agent-mcp/auth/credential-repository";
import { KmsUnavailableError } from "../../functions/src/rh-agent-mcp/auth/kms-cipher";
import { base64TestCipher, syntheticBundle } from "./rh-agent-mcp-credential-fixtures";

/**
 * Minimal firebase-admin Firestore fake honoring the surface
 * FirestoreDocStore uses: doc(path).{get,delete} and runTransaction with
 * txn.get(docRef)/txn.set(docRef, data) where doc refs carry their path.
 */
function fakeDb() {
  const docs = new Map<string, Record<string, unknown>>();
  const db = {
    doc(path: string) {
      return {
        path,
        get: async () => ({
          exists: docs.has(path),
          data: () => docs.get(path),
        }),
        delete: async () => {
          docs.delete(path);
        },
      };
    },
    async runTransaction<T>(
      update: (txn: {
        get(ref: { get(): Promise<unknown> }): Promise<unknown>;
        set(ref: { path: string }, data: Record<string, unknown>): void;
      }) => Promise<T>,
    ): Promise<T> {
      return update({
        get: (ref) => ref.get(),
        set: (ref, data) => {
          docs.set(ref.path, data);
        },
      });
    },
  };
  return { db: db as unknown as Firestore, docs };
}

describe("createKmsCredentialRepository (#1639)", () => {
  it("round-trips a bundle through the CAS transaction at rh-agent-credentials/bundle", async () => {
    const { db, docs } = fakeDb();
    const repository = createKmsCredentialRepository({
      db,
      cipher: base64TestCipher,
    });

    await repository.store(syntheticBundle(0, "access-1"), null);
    const stored = docs.get("rh-agent-credentials/bundle");
    assert.ok(stored, "expected a doc at rh-agent-credentials/bundle");
    assert.equal(stored.revision, 1);
    assert.equal(typeof stored.ciphertext, "string");
    assert.equal(
      (stored.ciphertext as string).includes("access-1"),
      false,
      "ciphertext must not contain plaintext token material",
    );

    const loaded = await repository.load();
    assert.equal(loaded?.tokens?.access_token, "access-1");
    assert.equal(loaded?.revision, 1);
  });

  it("a stale expectedRevision surfaces CredentialRevisionConflictError", async () => {
    const { db } = fakeDb();
    const repository = createKmsCredentialRepository({
      db,
      cipher: base64TestCipher,
    });

    await repository.store(syntheticBundle(0, "access-1"), null);
    await assert.rejects(
      () => repository.store(syntheticBundle(1, "access-2"), null),
      CredentialRevisionConflictError,
    );
  });

  it("load() returns null when the doc is absent", async () => {
    const { db } = fakeDb();
    const repository = createKmsCredentialRepository({
      db,
      cipher: base64TestCipher,
    });
    assert.equal(await repository.load(), null);
  });

  it("fails closed without a cipher or RH_CREDENTIAL_KEY_NAME — never falls back to another store", async () => {
    const keyName = process.env.RH_CREDENTIAL_KEY_NAME;
    delete process.env.RH_CREDENTIAL_KEY_NAME;
    try {
      const { db } = fakeDb();
      assert.throws(
        () => createKmsCredentialRepository({ db }),
        KmsUnavailableError,
      );
    } finally {
      if (keyName !== undefined) {
        process.env.RH_CREDENTIAL_KEY_NAME = keyName;
      }
    }
  });
});
