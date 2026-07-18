import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryTransport } from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js";
import { McpServer } from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import { runLocalOAuthBootstrapWithDependencies } from "../../functions/src/rh-agent-mcp/auth/local-oauth-bootstrap";
import {
  InMemoryCredentialRepository,
  MINIMAL_DISCOVERY_STATE,
  oauthResponse,
  storedCredential,
} from "./rh-agent-mcp-token-refresh-fixtures";

describe("local OAuth token refresh", () => {
  it("reuses a still-valid stored token without refreshing or opening the browser", async () => {
    const now = new Date("2026-07-18T19:00:00.000Z");
    const repository = new InMemoryCredentialRepository(storedCredential({
      accessToken: "synthetic-valid-access",
      refreshToken: "synthetic-valid-refresh",
      lastTokenResponseAt: "2026-07-18T18:30:00.000Z",
      discoveryState: MINIMAL_DISCOVERY_STATE,
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "synthetic-server", version: "1.0.0" });
    server.registerTool("read_only_probe", {}, async () => ({ content: [] }));
    await server.connect(serverTransport);

    try {
      const result = await runLocalOAuthBootstrapWithDependencies({
        repository,
        now: () => now,
        authorize: async () => {
          throw new Error("valid stored token must not refresh");
        },
        openAuthorizationUrl: async () => {
          throw new Error("browser must not open");
        },
        transportFactory: () => clientTransport,
        callbackPort: 0,
        callbackTimeoutMs: 2_000,
      });

      assert.equal(result.state, "CONNECTED");
      assert.equal(result.evidence.resultCategory, "STORED_CREDENTIAL_REUSED");
      assert.equal(result.evidence.toolCount, 1);
      assert.equal((await repository.load())?.revision, 7);
    } finally {
      await server.close();
    }
  });

  it("persists a rotated refresh token before connecting with an expired credential", async () => {
    const now = new Date("2026-07-18T19:00:00.000Z");
    const repository = new InMemoryCredentialRepository(storedCredential({
      accessToken: "synthetic-expired-access",
      refreshToken: "synthetic-old-refresh",
      lastTokenResponseAt: "2026-07-18T17:00:00.000Z",
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "synthetic-server", version: "1.0.0" });
    server.registerTool("read_only_probe", {}, async () => ({ content: [] }));
    await server.connect(serverTransport);
    let refreshRequestBody = "";

    try {
      const result = await runLocalOAuthBootstrapWithDependencies({
        repository,
        now: () => now,
        authorize: async () => {
          throw new Error("expired stored token must use the explicit refresh path");
        },
        refreshFetch: async (_input: string | URL | Request, init?: RequestInit) => {
          refreshRequestBody = String(init?.body ?? "");
          return new Response(JSON.stringify({
            access_token: "synthetic-rotated-access",
            refresh_token: "synthetic-rotated-refresh",
            expires_in: 7_200,
            token_type: "Bearer",
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
        openAuthorizationUrl: async () => {
          throw new Error("browser must not open");
        },
        transportFactory: (_serverUrl, accessToken) => {
          assert.equal(accessToken, "synthetic-rotated-access");
          const stored = repository.current();
          assert.equal(stored?.revision, 8);
          assert.equal(stored?.tokens.access_token, "synthetic-rotated-access");
          assert.equal(stored?.tokens.refresh_token, "synthetic-rotated-refresh");
          assert.equal(stored?.lastTokenResponseAt, now.toISOString());
          return clientTransport;
        },
        callbackPort: 0,
        callbackTimeoutMs: 2_000,
      });

      assert.equal(result.state, "CONNECTED");
      assert.equal(result.evidence.resultCategory, "STORED_CREDENTIAL_REFRESHED");
      assert.equal(result.evidence.toolCount, 1);
      assert.equal(result.evidence.refreshAttempted, true);
      assert.equal(result.evidence.refreshSucceeded, true);
      assert.equal(result.evidence.refreshTokenRotated, true);
      assert.equal(result.evidence.credentialRevisionAdvanced, true);
      assert.equal(result.evidence.subsequentCallSucceeded, true);
      assert.equal(refreshRequestBody.includes("grant_type=refresh_token"), true);
      const serializedEvidence = JSON.stringify(result.evidence);
      assert.equal(serializedEvidence.includes("synthetic-expired-access"), false);
      assert.equal(serializedEvidence.includes("synthetic-old-refresh"), false);
      assert.equal(serializedEvidence.includes("synthetic-rotated-access"), false);
      assert.equal(serializedEvidence.includes("synthetic-rotated-refresh"), false);

      const [restartClientTransport, restartServerTransport] = InMemoryTransport.createLinkedPair();
      const restartServer = new McpServer({ name: "synthetic-server", version: "1.0.0" });
      restartServer.registerTool("read_only_probe", {}, async () => ({ content: [] }));
      await restartServer.connect(restartServerTransport);
      try {
        const restarted = await runLocalOAuthBootstrapWithDependencies({
          repository,
          now: () => new Date("2026-07-18T19:05:00.000Z"),
          refreshFetch: async () => {
            throw new Error("fresh process must reuse the persisted refreshed token");
          },
          openAuthorizationUrl: async () => {
            throw new Error("browser must not open");
          },
          transportFactory: () => restartClientTransport,
          callbackPort: 0,
          callbackTimeoutMs: 2_000,
        });
        assert.equal(restarted.state, "CONNECTED");
        assert.equal(restarted.evidence.resultCategory, "STORED_CREDENTIAL_REUSED");
        assert.equal(restarted.evidence.refreshAttempted, false);
      } finally {
        await restartServer.close();
      }
    } finally {
      await server.close();
    }
  });

  it("preserves the existing refresh token when the refresh response omits it", async () => {
    const now = new Date("2026-07-18T19:00:00.000Z");
    const repository = new InMemoryCredentialRepository(storedCredential({
      accessToken: "synthetic-expired-access",
      refreshToken: "synthetic-existing-refresh",
      lastTokenResponseAt: "2026-07-18T17:00:00.000Z",
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "synthetic-server", version: "1.0.0" });
    server.registerTool("read_only_probe", {}, async () => ({ content: [] }));
    await server.connect(serverTransport);

    try {
      const result = await runLocalOAuthBootstrapWithDependencies({
        repository,
        now: () => now,
        refreshFetch: async () => new Response(JSON.stringify({
          access_token: "synthetic-new-access",
          expires_in: 7_200,
          token_type: "Bearer",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
        openAuthorizationUrl: async () => {
          throw new Error("browser must not open");
        },
        transportFactory: () => clientTransport,
        callbackPort: 0,
        callbackTimeoutMs: 2_000,
      });

      assert.equal(result.state, "CONNECTED");
      assert.equal(result.evidence.refreshTokenRotated, false);
      assert.equal(repository.current()?.tokens.refresh_token, "synthetic-existing-refresh");
    } finally {
      await server.close();
    }
  });

  it("refreshes a still-valid token when forceRefresh is requested", async () => {
    const now = new Date("2026-07-18T19:00:00.000Z");
    const repository = new InMemoryCredentialRepository(storedCredential({
      accessToken: "synthetic-valid-access",
      refreshToken: "synthetic-valid-refresh",
      lastTokenResponseAt: "2026-07-18T18:30:00.000Z",
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "synthetic-server", version: "1.0.0" });
    server.registerTool("read_only_probe", {}, async () => ({ content: [] }));
    await server.connect(serverTransport);

    try {
      const result = await runLocalOAuthBootstrapWithDependencies({
        repository,
        now: () => now,
        forceRefresh: true,
        refreshFetch: async () => oauthResponse({
          access_token: "synthetic-forced-access",
          refresh_token: "synthetic-forced-refresh",
          expires_in: 7_200,
          token_type: "Bearer",
        }),
        openAuthorizationUrl: async () => {
          throw new Error("browser must not open");
        },
        transportFactory: (_serverUrl, accessToken) => {
          assert.equal(accessToken, "synthetic-forced-access");
          return clientTransport;
        },
        callbackPort: 0,
        callbackTimeoutMs: 2_000,
      });

      assert.equal(result.state, "CONNECTED");
      assert.equal(result.evidence.resultCategory, "STORED_CREDENTIAL_REFRESHED");
      assert.equal(result.evidence.refreshAttempted, true);
      assert.equal(result.evidence.refreshSucceeded, true);
      assert.equal(repository.current()?.tokens.access_token, "synthetic-forced-access");
      assert.equal(repository.current()?.tokens.refresh_token, "synthetic-forced-refresh");
      assert.equal(repository.current()?.revision, 8);
    } finally {
      await server.close();
    }
  });
});
