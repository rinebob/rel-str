import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  EncryptedFileCredentialRepository,
  type CredentialCipher,
} from "../../functions/src/rh-agent-mcp/auth/encrypted-file-credential-repository";
import { DpapiCredentialCipher } from "../../functions/src/rh-agent-mcp/auth/dpapi-credential-cipher";
import { RepositoryOAuthProvider } from "../../functions/src/rh-agent-mcp/auth/repository-oauth-provider";
import type {
  RobinhoodCredentialBundle,
  RobinhoodCredentialRepository,
} from "../../functions/src/rh-agent-mcp/index";

const cipher: CredentialCipher = {
  encrypt: async (plaintext: string) => Buffer.from(plaintext, "utf8").toString("base64"),
  decrypt: async (ciphertext: string) => Buffer.from(ciphertext, "base64").toString("utf8"),
};

function bundle(revision: number, accessToken: string): RobinhoodCredentialBundle {
  return {
    schemaVersion: 1,
    revision,
    tokens: {
      access_token: accessToken,
      refresh_token: "synthetic-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
    },
    clientInformation: { client_id: "synthetic-client-id" },
    discoveryState: { authorizationServerUrl: "https://synthetic.invalid" },
  };
}

describe("DpapiCredentialCipher", () => {
  it("round-trips encrypted content without retaining plaintext", async () => {
    if (process.platform !== "win32") return;
    const dpapi = new DpapiCredentialCipher();
    const plaintext = `synthetic-${Date.now()}`;

    const encrypted = await dpapi.encrypt(plaintext);

    assert.equal(encrypted.includes(plaintext), false);
    assert.equal(await dpapi.decrypt(encrypted), plaintext);
  });
});

describe("EncryptedFileCredentialRepository", () => {
  it("rejects a decrypted bundle whose nested OAuth fields are invalid", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rh-agent-mcp-"));
    const filePath = join(directory, "credentials.enc");
    const repository = new EncryptedFileCredentialRepository(filePath, cipher);
    const malformed = {
      ...bundle(1, "synthetic-access"),
      tokens: {
        access_token: "synthetic-access",
        token_type: "Bearer",
        expires_in: "not-a-number",
      },
    };

    try {
      await writeFile(filePath, await cipher.encrypt(JSON.stringify(malformed)), "utf8");
      await assert.rejects(repository.load(), { name: "InvalidCredentialBundleError" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("recovers a stale write lock left by an interrupted process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rh-agent-mcp-"));
    const filePath = join(directory, "credentials.enc");
    const lockPath = `${filePath}.lock`;
    const repository = new EncryptedFileCredentialRepository(filePath, cipher);

    try {
      await mkdir(lockPath);
      const staleTime = new Date(Date.now() - 10 * 60 * 1_000);
      await utimes(lockPath, staleTime, staleTime);
      const stored = await repository.store(bundle(0, "synthetic-access"), null);
      assert.equal(stored.revision, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("encrypts the bundle and enforces revision compare-and-swap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rh-agent-mcp-"));
    const filePath = join(directory, "credentials.enc");
    const repository = new EncryptedFileCredentialRepository(filePath, cipher);

    try {
      const first = await repository.store(bundle(0, "synthetic-access-one"), null);
      assert.equal(first.revision, 1);
      assert.deepEqual(await repository.load(), first);
      const persisted = await readFile(filePath, "utf8");
      assert.equal(persisted.includes("synthetic-access-one"), false);

      await assert.rejects(
        repository.store(bundle(0, "synthetic-stale"), null),
        { name: "CredentialRevisionConflictError" },
      );

      const second = await repository.store(
        bundle(first.revision, "synthetic-access-two"),
        first.revision,
      );
      assert.equal(second.revision, 2);
      assert.equal((await repository.load())?.tokens.access_token, "synthetic-access-two");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("RepositoryOAuthProvider", () => {
  it("does not publish new tokens in memory when persistence fails", async () => {
    const original = bundle(1, "synthetic-access-one");
    const repository: RobinhoodCredentialRepository = {
      load: async () => original,
      store: async () => {
        throw new Error("synthetic persistence failure");
      },
      delete: async () => undefined,
    };
    const provider = new RepositoryOAuthProvider(repository, {
      redirectUrl: "http://127.0.0.1:3456/callback",
      openAuthorizationUrl: async () => undefined,
    });
    await provider.tokens();

    await assert.rejects(provider.saveTokens({
      access_token: "synthetic-access-two",
      token_type: "Bearer",
    }));

    assert.equal((await provider.tokens())?.access_token, "synthetic-access-one");
  });

  it("persists tokens with client information and discovery state for a new provider", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rh-agent-mcp-"));
    const repository = new EncryptedFileCredentialRepository(
      join(directory, "credentials.enc"),
      cipher,
    );
    const provider = new RepositoryOAuthProvider(repository, {
      redirectUrl: "http://127.0.0.1:3456/callback",
      state: "synthetic-state",
      openAuthorizationUrl: async () => undefined,
    });

    try {
      await provider.saveDiscoveryState({
        authorizationServerUrl: "https://synthetic.invalid",
      });
      await provider.saveClientInformation({ client_id: "synthetic-client-id" });
      await provider.saveTokens({
        access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      });

      const restarted = new RepositoryOAuthProvider(repository, {
        redirectUrl: "http://127.0.0.1:3456/callback",
        openAuthorizationUrl: async () => {
          throw new Error("browser must not open");
        },
      });

      assert.equal((await restarted.tokens())?.access_token, "synthetic-access-token");
      assert.equal((await restarted.clientInformation())?.client_id, "synthetic-client-id");
      assert.equal(
        (await restarted.discoveryState())?.authorizationServerUrl,
        "https://synthetic.invalid",
      );
      assert.equal(restarted.snapshot().credentialsPersisted, true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
