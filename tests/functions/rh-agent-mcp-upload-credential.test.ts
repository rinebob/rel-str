import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  readBundleFile,
  uploadCredentialBundle,
  UploadRoundTripError,
} from "../../functions/src/rh-agent-mcp/auth/upload-credential-bundle";
import { CredentialRevisionConflictError } from "../../functions/src/rh-agent-mcp/auth/credential-repository";
import type { RobinhoodCredentialRepository } from "../../functions/src/rh-agent-mcp/auth/credential-repository";
import type { RobinhoodCredentialBundle } from "../../functions/src/rh-agent-mcp/contracts/authentication";
import { syntheticBundle } from "./rh-agent-mcp-credential-fixtures";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * In-memory repository honoring the same CAS contract as
 * KmsFirestoreCredentialRepository — store overrides revision from
 * expectedRevision, conflict when the stored revision moved.
 */
function memoryRepository(): RobinhoodCredentialRepository {
  let stored: RobinhoodCredentialBundle | null = null;
  return {
    load: async () => stored,
    store: async (bundle, expectedRevision) => {
      const current = stored?.revision ?? null;
      if (current !== expectedRevision) {
        throw new CredentialRevisionConflictError();
      }
      stored = { ...bundle, schemaVersion: 1, revision: (expectedRevision ?? 0) + 1 };
      return stored;
    },
    delete: async () => {
      stored = null;
    },
  };
}

describe("readBundleFile", () => {
  it("parses a valid portable bundle file", async () => {
    const bundle = await readBundleFile(
      join(FIXTURES, "rh-credential-bundle-valid.json"),
    );
    assert.equal(bundle.tokens.access_token, "synthetic-access-upload-fixture");
    assert.equal(bundle.revision, 7);
  });

  it("fails closed on a malformed bundle file", async () => {
    await assert.rejects(
      readBundleFile(join(FIXTURES, "rh-credential-bundle-malformed.json")),
      /InvalidCredentialBundleError|invalid/i,
    );
  });

  it("propagates a missing-file error", async () => {
    await assert.rejects(
      readBundleFile(join(FIXTURES, "does-not-exist.json")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
  });
});

describe("uploadCredentialBundle", () => {
  it("seeds with revision 1 and returns structural evidence only", async () => {
    const repository = memoryRepository();
    const evidence = await uploadCredentialBundle(
      repository,
      syntheticBundle(7, "synthetic-access-seed"),
    );

    assert.equal(evidence.mode, "seed");
    assert.equal(evidence.revision, 1);
    assert.equal(evidence.schemaVersion, 1);
    assert.equal(evidence.reloadedEquivalent, true);

    // AC: no token values in the evidence surface.
    const serialized = JSON.stringify(evidence);
    assert.ok(!serialized.includes("synthetic-access-seed"));
    assert.ok(!serialized.includes("synthetic-refresh-token"));
    assert.ok(!/"access_token"/.test(serialized));
  });

  it("refuses to overwrite an existing doc in seed mode", async () => {
    const repository = memoryRepository();
    await uploadCredentialBundle(repository, syntheticBundle(0, "first"));

    await assert.rejects(
      uploadCredentialBundle(repository, syntheticBundle(0, "second")),
      CredentialRevisionConflictError,
    );
  });

  it("replace mode CAS-succeeds on the current revision", async () => {
    const repository = memoryRepository();
    await uploadCredentialBundle(repository, syntheticBundle(0, "first"));

    const evidence = await uploadCredentialBundle(
      repository,
      syntheticBundle(0, "synthetic-access-replaced"),
      { replace: true },
    );
    assert.equal(evidence.mode, "replace");
    assert.equal(evidence.revision, 2);
    assert.equal((await repository.load())?.tokens.access_token, "synthetic-access-replaced");
  });

  it("replace mode on an empty doc seeds at revision 1", async () => {
    const evidence = await uploadCredentialBundle(
      memoryRepository(),
      syntheticBundle(0, "fresh"),
      { replace: true },
    );
    assert.equal(evidence.revision, 1);
  });

  it("throws UploadRoundTripError naming the field when the reload does not match", async () => {
    const tampered = { ...syntheticBundle(1, "original") };
    delete tampered.discoveryState; // silently dropped field
    const corrupting: RobinhoodCredentialRepository = {
      load: async () => tampered,
      store: async (bundle) => ({ ...bundle, schemaVersion: 1, revision: 1 }),
      delete: async () => undefined,
    };
    await assert.rejects(
      uploadCredentialBundle(corrupting, syntheticBundle(0, "original")),
      (error: Error) =>
        error instanceof UploadRoundTripError &&
        /discoveryState/.test(error.message),
    );
  });

  it("propagates a CAS conflict raised inside replace (lost the race)", async () => {
    // load returns rev 1 but store has already moved to rev 2.
    const racing: RobinhoodCredentialRepository = {
      load: async () => syntheticBundle(1, "first"),
      store: async (_bundle, expectedRevision) => {
        if (expectedRevision !== 2) throw new CredentialRevisionConflictError();
        return syntheticBundle(2, "first");
      },
      delete: async () => undefined,
    };
    await assert.rejects(
      uploadCredentialBundle(racing, syntheticBundle(0, "second"), {
        replace: true,
      }),
      CredentialRevisionConflictError,
    );
  });
});
