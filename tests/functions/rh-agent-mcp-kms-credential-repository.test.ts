import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createKmsCipherFromEnv,
  KmsCipher,
  type KmsCryptoOperations,
} from "../../functions/src/rh-agent-mcp/auth/kms-cipher";
import {
  KmsFirestoreCredentialRepository,
  TransactionalCredentialDocumentBackend,
} from "../../functions/src/rh-agent-mcp/auth/kms-firestore-credential-repository";
import type {
  CredentialDocumentBackend,
  CredentialDocStore,
  StoredCredentialDoc,
} from "../../functions/src/rh-agent-mcp/auth/kms-firestore-credential-repository";
import { CredentialRevisionConflictError } from "../../functions/src/rh-agent-mcp/auth/credential-repository";
import { base64TestCipher, syntheticBundle } from "./rh-agent-mcp-credential-fixtures";

/**
 * In-memory CredentialDocumentBackend honoring the same CAS contract as the
 * transactional adapter — this is the seam the repository is tested at.
 */
function memoryBackend(): CredentialDocumentBackend & { doc(): StoredCredentialDoc | null } {
  let stored: StoredCredentialDoc | null = null;
  return {
    doc: () => stored,
    load: async () => stored,
    store: async (ciphertext: string, revision: number, expectedRevision: number | null) => {
      const current = stored?.revision ?? null;
      if (current !== expectedRevision) {
        throw new CredentialRevisionConflictError();
      }
      stored = { ciphertext, revision };
    },
    delete: async () => {
      stored = null;
    },
  };
}

/**
 * In-memory CredentialDocStore — runs the update callback against shared
 * doc state (read-check-write inside one callback). Lets the REAL
 * TransactionalCredentialDocumentBackend txn body be exercised offline.
 */
function memoryDocStore(): CredentialDocStore & { peek(path: string): StoredCredentialDoc | null } {
  const docs = new Map<string, StoredCredentialDoc>();
  return {
    peek: (path) => docs.get(path) ?? null,
    get: async (path) => ({
      exists: docs.has(path),
      data: () => docs.get(path),
    }),
    delete: async (path) => {
      docs.delete(path);
    },
    runTransaction: async (update) =>
      update({
        get: async (path) => ({
          exists: docs.has(path),
          data: () => docs.get(path),
        }),
        set: (path, data) => {
          docs.set(path, data as StoredCredentialDoc);
        },
      }),
  };
}

describe("KmsFirestoreCredentialRepository", () => {
  it("returns null when the credential doc does not exist", async () => {
    const repository = new KmsFirestoreCredentialRepository(memoryBackend(), base64TestCipher);
    assert.equal(await repository.load(), null);
  });

  it("stores ciphertext (never plaintext) and round-trips through load", async () => {
    const backend = memoryBackend();
    const repository = new KmsFirestoreCredentialRepository(backend, base64TestCipher);

    const stored = await repository.store(syntheticBundle(0, "synthetic-access-one"), null);

    assert.equal(stored.revision, 1);
    const persisted = backend.doc();
    assert.ok(persisted);
    assert.equal(persisted.revision, 1);
    assert.equal(persisted.ciphertext.includes("synthetic-access-one"), false);
    assert.equal(persisted.ciphertext.includes("synthetic-refresh-token"), false);

    assert.deepEqual(await repository.load(), stored);
  });

  it("enforces revision compare-and-swap on store", async () => {
    const repository = new KmsFirestoreCredentialRepository(memoryBackend(), base64TestCipher);
    const first = await repository.store(syntheticBundle(0, "synthetic-access-one"), null);

    await assert.rejects(
      repository.store(syntheticBundle(0, "synthetic-stale-null"), null),
      CredentialRevisionConflictError,
    );
    await assert.rejects(
      repository.store(syntheticBundle(0, "synthetic-stale-zero"), 0),
      CredentialRevisionConflictError,
    );

    const second = await repository.store(
      syntheticBundle(first.revision, "synthetic-access-two"),
      first.revision,
    );
    assert.equal(second.revision, 2);
    assert.equal((await repository.load())?.tokens.access_token, "synthetic-access-two");
  });

  it("lets a CAS loser reload the winner's revision and retry", async () => {
    const repository = new KmsFirestoreCredentialRepository(memoryBackend(), base64TestCipher);
    await repository.store(syntheticBundle(0, "winner"), null);

    // Loser raced with a stale expected revision.
    await assert.rejects(
      repository.store(syntheticBundle(0, "loser"), null),
      CredentialRevisionConflictError,
    );
    const winner = await repository.load();
    assert.ok(winner);
    const retried = await repository.store(syntheticBundle(0, "loser-after-reload"), winner.revision);
    assert.equal(retried.revision, winner.revision + 1);
    assert.equal((await repository.load())?.tokens.access_token, "loser-after-reload");
  });

  it("rejects a stored doc whose decrypted payload is not a valid bundle", async () => {
    const backend = memoryBackend();
    await backend.store(
      await base64TestCipher.encrypt(JSON.stringify({ nope: true })),
      1,
      null,
    );
    const repository = new KmsFirestoreCredentialRepository(backend, base64TestCipher);
    await assert.rejects(repository.load(), { name: "InvalidCredentialBundleError" });
  });

  it("delete removes the credential doc", async () => {
    const repository = new KmsFirestoreCredentialRepository(memoryBackend(), base64TestCipher);
    await repository.store(syntheticBundle(0, "synthetic-access"), null);
    await repository.delete();
    assert.equal(await repository.load(), null);
  });
});

describe("TransactionalCredentialDocumentBackend (real txn body, in-memory store)", () => {
  const PATH = "rh-agent-credentials/verify-fixture";

  it("load returns null for a missing doc and rejects a malformed one", async () => {
    const docs = memoryDocStore();
    const backend = new TransactionalCredentialDocumentBackend(docs, PATH);

    assert.equal(await backend.load(), null);

    // Plant malformed data directly — ciphertext that isn't a string.
    await docs.runTransaction(async (t) => {
      t.set(PATH, { ciphertext: 42 });
    });
    await assert.rejects(backend.load(), /Malformed credential doc/);
  });

  it("store writes ciphertext + revision and CAS-aborts on a stale expected revision", async () => {
    const docs = memoryDocStore();
    const backend = new TransactionalCredentialDocumentBackend(docs, PATH);

    await backend.store("cipher-one", 1, null);
    const written = docs.peek(PATH);
    assert.ok(written);
    assert.equal(written.ciphertext, "cipher-one");
    assert.equal(written.revision, 1);
    assert.deepEqual(Object.keys(written).sort(), ["ciphertext", "revision", "updatedAt"]);

    await assert.rejects(
      backend.store("cipher-stale", 1, null),
      CredentialRevisionConflictError,
    );
    await assert.rejects(
      backend.store("cipher-stale2", 4, 0),
      CredentialRevisionConflictError,
    );

    await backend.store("cipher-two", 2, 1);
    assert.equal(docs.peek(PATH)?.ciphertext, "cipher-two");
  });

  it("delete removes the doc", async () => {
    const docs = memoryDocStore();
    const backend = new TransactionalCredentialDocumentBackend(docs, PATH);
    await backend.store("cipher-one", 1, null);
    await backend.delete();
    assert.equal(await backend.load(), null);
  });
});

describe("KmsCipher", () => {
  const KEY = "projects/p/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials";

  /** Fake KMS ops — reverses bytes so ciphertext ≠ plaintext. */
  function fakeKms(): KmsCryptoOperations & { calls: { kind: string; name: string }[] } {
    const calls: { kind: string; name: string }[] = [];
    return {
      calls,
      encrypt: async (request) => {
        calls.push({ kind: "encrypt", name: request.name });
        return [{ ciphertext: Buffer.from(request.plaintext).reverse() }];
      },
      decrypt: async (request) => {
        calls.push({ kind: "decrypt", name: request.name });
        return [{ plaintext: Buffer.from(request.ciphertext).reverse() }];
      },
    };
  }

  it("encrypts via KMS and returns base64 ciphertext", async () => {
    const kms = fakeKms();
    const cipher = new KmsCipher(kms, KEY);

    const ciphertext = await cipher.encrypt("sensitive-token-material");

    assert.equal(kms.calls.length, 1);
    assert.equal(kms.calls[0].name, KEY);
    // base64 of reversed plaintext — not plaintext itself.
    assert.equal(ciphertext.includes("sensitive-token-material"), false);
    assert.match(ciphertext, /^[A-Za-z0-9+/=]+$/);
  });

  it("round-trips plaintext through encrypt + decrypt", async () => {
    const cipher = new KmsCipher(fakeKms(), KEY);
    const plaintext = JSON.stringify(syntheticBundle(1, "synthetic-access"));

    const ciphertext = await cipher.encrypt(plaintext);
    assert.equal(await cipher.decrypt(ciphertext), plaintext);
  });

  it("throws when KMS returns no ciphertext", async () => {
    const kms: KmsCryptoOperations = {
      encrypt: async () => [{}],
      decrypt: async () => [{}],
    };
    const cipher = new KmsCipher(kms, KEY);
    await assert.rejects(cipher.encrypt("x"), /no ciphertext/i);
    await assert.rejects(cipher.decrypt("eA=="), /no plaintext/i);
  });

  it("createKmsCipherFromEnv fails closed when the key name is unset", () => {
    assert.throws(() => createKmsCipherFromEnv({}), /RH_CREDENTIAL_KEY_NAME/);
  });
});
