import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CredentialRevisionConflictError } from "../../functions/src/rh-agent-mcp/auth/encrypted-file-credential-repository";
import { runLocalOAuthBootstrapWithDependencies } from "../../functions/src/rh-agent-mcp/auth/local-oauth-bootstrap";
import type {
  RobinhoodCredentialBundle,
  RobinhoodCredentialRepository,
} from "../../functions/src/rh-agent-mcp/index";
import {
  CURRENT_TIME,
  InMemoryCredentialRepository,
  MINIMAL_DISCOVERY_STATE,
  oauthResponse,
  storedCredential,
} from "./rh-agent-mcp-token-refresh-fixtures";

describe("local OAuth token refresh failures", () => {
  it("does not use rotated credentials when durable refresh persistence fails", async () => {
    const original = storedCredential({
      accessToken: "synthetic-expired-access",
      refreshToken: "synthetic-old-refresh",
      lastTokenResponseAt: "2026-07-18T17:00:00.000Z",
    });
    const repository: RobinhoodCredentialRepository = {
      load: async () => original,
      store: async () => {
        throw new Error("synthetic persistence failure");
      },
      delete: async () => undefined,
    };
    let transportCreated = false;

    const result = await runLocalOAuthBootstrapWithDependencies({
      repository,
      now: () => CURRENT_TIME,
      refreshFetch: async () => oauthResponse({
        access_token: "synthetic-lost-access",
        refresh_token: "synthetic-lost-refresh",
        expires_in: 7_200,
        token_type: "Bearer",
      }),
      openAuthorizationUrl: async () => {
        throw new Error("browser must not open");
      },
      transportFactory: () => {
        transportCreated = true;
        throw new Error("MCP transport must not start after persistence failure");
      },
      callbackPort: 0,
      callbackTimeoutMs: 2_000,
    });

    assert.equal(result.state, "TEMPORARILY_UNAVAILABLE");
    assert.equal(result.evidence.resultCategory, "REFRESH_FAILED");
    assert.equal(result.evidence.refreshSucceeded, false);
    assert.equal(result.evidence.credentialRevisionAdvanced, false);
    assert.equal(transportCreated, false);
    assert.equal(original.tokens.access_token, "synthetic-expired-access");
    assert.equal(JSON.stringify(result.evidence).includes("synthetic-lost"), false);
  });

  it("does not overwrite a newer credential or start MCP after a refresh CAS conflict", async () => {
    const original = storedCredential({
      accessToken: "synthetic-expired-access",
      refreshToken: "synthetic-old-refresh",
      lastTokenResponseAt: "2026-07-18T17:00:00.000Z",
    });
    const winner: RobinhoodCredentialBundle = {
      ...original,
      revision: 8,
      tokens: {
        ...original.tokens,
        access_token: "synthetic-winner-access",
        refresh_token: "synthetic-winner-refresh",
      },
      lastTokenResponseAt: CURRENT_TIME.toISOString(),
    };
    let durable = original;
    const repository: RobinhoodCredentialRepository = {
      load: async () => durable,
      store: async () => {
        durable = winner;
        throw new CredentialRevisionConflictError();
      },
      delete: async () => undefined,
    };
    let transportCreated = false;

    const result = await runLocalOAuthBootstrapWithDependencies({
      repository,
      now: () => CURRENT_TIME,
      refreshFetch: async () => oauthResponse({
        access_token: "synthetic-stale-access",
        refresh_token: "synthetic-stale-refresh",
        expires_in: 7_200,
        token_type: "Bearer",
      }),
      openAuthorizationUrl: async () => {
        throw new Error("browser must not open");
      },
      transportFactory: () => {
        transportCreated = true;
        throw new Error("MCP transport must not start after a CAS conflict");
      },
      callbackPort: 0,
      callbackTimeoutMs: 2_000,
    });

    assert.equal(result.state, "TEMPORARILY_UNAVAILABLE");
    assert.equal(result.evidence.resultCategory, "REFRESH_FAILED");
    assert.equal(result.evidence.refreshSucceeded, false);
    assert.equal(transportCreated, false);
    assert.equal(durable.tokens.access_token, "synthetic-winner-access");
    assert.equal(durable.tokens.refresh_token, "synthetic-winner-refresh");
  });

  it("requires reauthorization when the refresh grant is rejected", async () => {
    const repository = new InMemoryCredentialRepository(storedCredential({
      accessToken: "synthetic-expired-access",
      refreshToken: "synthetic-rejected-refresh",
      lastTokenResponseAt: "2026-07-18T17:00:00.000Z",
    }));
    let browserOpened = false;
    let transportCreated = false;

    const result = await runLocalOAuthBootstrapWithDependencies({
      repository,
      now: () => CURRENT_TIME,
      refreshFetch: async () => oauthResponse({ error: "invalid_grant" }, 400),
      openAuthorizationUrl: async () => {
        browserOpened = true;
      },
      transportFactory: () => {
        transportCreated = true;
        throw new Error("MCP transport must not start after invalid grant");
      },
      callbackPort: 0,
      callbackTimeoutMs: 2_000,
    });

    assert.equal(result.state, "REAUTHORIZATION_REQUIRED");
    assert.equal(result.evidence.resultCategory, "REFRESH_FAILED");
    assert.equal(result.evidence.refreshAttempted, true);
    assert.equal(result.evidence.refreshSucceeded, false);
    assert.equal(browserOpened, false);
    assert.equal(transportCreated, false);
    assert.equal((await repository.load())?.revision, 7);
  });

  it("reports temporary unavailability when the refresh service fails", async () => {
    const repository = new InMemoryCredentialRepository(storedCredential({
      accessToken: "synthetic-expired-access",
      refreshToken: "synthetic-refresh",
      lastTokenResponseAt: "2026-07-18T17:00:00.000Z",
    }));
    let transportCreated = false;

    const result = await runLocalOAuthBootstrapWithDependencies({
      repository,
      now: () => CURRENT_TIME,
      refreshFetch: async () => oauthResponse({ error: "server_error" }, 503),
      openAuthorizationUrl: async () => {
        throw new Error("browser must not open");
      },
      transportFactory: () => {
        transportCreated = true;
        throw new Error("MCP transport must not start after refresh service failure");
      },
      callbackPort: 0,
      callbackTimeoutMs: 2_000,
    });

    assert.equal(result.state, "TEMPORARILY_UNAVAILABLE");
    assert.equal(result.evidence.resultCategory, "REFRESH_FAILED");
    assert.equal(result.evidence.refreshAttempted, true);
    assert.equal(result.evidence.refreshSucceeded, false);
    assert.equal(transportCreated, false);
  });

  it("requires reauthorization when an expired credential has no refresh token", async () => {
    const repository = new InMemoryCredentialRepository(storedCredential({
      accessToken: "synthetic-expired-access",
      lastTokenResponseAt: "2026-07-18T17:00:00.000Z",
      discoveryState: MINIMAL_DISCOVERY_STATE,
    }));
    let browserOpened = false;
    let transportCreated = false;

    const result = await runLocalOAuthBootstrapWithDependencies({
      repository,
      now: () => CURRENT_TIME,
      openAuthorizationUrl: async () => {
        browserOpened = true;
      },
      transportFactory: () => {
        transportCreated = true;
        throw new Error("MCP transport must not start without refresh credentials");
      },
      callbackPort: 0,
      callbackTimeoutMs: 2_000,
    });

    assert.equal(result.state, "REAUTHORIZATION_REQUIRED");
    assert.equal(result.evidence.resultCategory, "REFRESH_FAILED");
    assert.equal(result.evidence.refreshAttempted, true);
    assert.equal(result.evidence.refreshSucceeded, false);
    assert.equal(browserOpened, false);
    assert.equal(transportCreated, false);
  });
});
