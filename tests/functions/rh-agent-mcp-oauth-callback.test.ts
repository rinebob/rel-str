import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { InMemoryTransport } from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js";
import { McpServer } from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import type { OAuthClientProvider } from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js";
import { runLocalOAuthBootstrapWithDependencies } from "../../functions/src/rh-agent-mcp/auth/local-oauth-bootstrap";
import { startLocalOAuthCallbackServer } from "../../functions/src/rh-agent-mcp/auth/local-oauth-callback-server";
import type { OAuthAuthorizationDriver } from "../../functions/src/rh-agent-mcp/auth/local-oauth-bootstrap";
import type {
  RobinhoodCredentialBundle,
  RobinhoodCredentialRepository,
} from "../../functions/src/rh-agent-mcp/index";

function syntheticValue(): string {
  return randomBytes(24).toString("base64url");
}

class InMemoryCredentialRepository implements RobinhoodCredentialRepository {
  private credential: RobinhoodCredentialBundle | null = null;

  async load(): Promise<RobinhoodCredentialBundle | null> {
    return this.credential;
  }

  async store(
    credential: RobinhoodCredentialBundle,
    expectedRevision: number | null,
  ): Promise<RobinhoodCredentialBundle> {
    assert.equal(this.credential?.revision ?? null, expectedRevision);
    this.credential = {
      ...credential,
      revision: (this.credential?.revision ?? 0) + 1,
    };
    return this.credential;
  }

  async delete(): Promise<void> {
    this.credential = null;
  }
}

describe("local OAuth callback server", () => {
  it("accepts one callback with the exact state and returns no secrets to the browser", async () => {
    const expectedState = syntheticValue();
    const authorizationCode = syntheticValue();
    const server = await startLocalOAuthCallbackServer({
      expectedState,
      port: 0,
      timeoutMs: 2_000,
    });

    const response = await fetch(
      `${server.redirectUrl}?code=${encodeURIComponent(authorizationCode)}&state=${encodeURIComponent(expectedState)}`,
    );
    const body = await response.text();
    const callback = await server.callback;

    assert.equal(response.status, 200);
    assert.equal(body.includes(authorizationCode), false);
    assert.equal(body.includes(expectedState), false);
    assert.equal(callback.takeAuthorizationCode(), authorizationCode);
    assert.throws(() => callback.takeAuthorizationCode(), { name: "OAuthCallbackCodeConsumedError" });
  });

  it("rejects a mismatched state and remains available for the valid callback", async () => {
    const expectedState = syntheticValue();
    const server = await startLocalOAuthCallbackServer({
      expectedState,
      port: 0,
      timeoutMs: 2_000,
    });

    const rejected = await fetch(
      `${server.redirectUrl}?code=${encodeURIComponent(syntheticValue())}&state=${encodeURIComponent(syntheticValue())}`,
    );
    const authorizationCode = syntheticValue();
    const accepted = await fetch(
      `${server.redirectUrl}?code=${encodeURIComponent(authorizationCode)}&state=${encodeURIComponent(expectedState)}`,
    );
    const callback = await server.callback;

    assert.equal(rejected.status, 400);
    assert.equal(accepted.status, 200);
    assert.equal(callback.takeAuthorizationCode(), authorizationCode);
  });

  it("rejects an OAuth error and releases the callback port", async () => {
    const expectedState = syntheticValue();
    const server = await startLocalOAuthCallbackServer({
      expectedState,
      port: 0,
      timeoutMs: 2_000,
    });

    const callbackRejection = assert.rejects(
      server.callback,
      { name: "OAuthCallbackAuthorizationError" },
    );
    const response = await fetch(
      `${server.redirectUrl}?error=access_denied&state=${encodeURIComponent(expectedState)}`,
    );

    assert.equal(response.status, 400);
    await callbackRejection;
    await assert.rejects(fetch(server.redirectUrl));
  });

  it("closes after the valid callback so it cannot be replayed", async () => {
    const expectedState = syntheticValue();
    const server = await startLocalOAuthCallbackServer({
      expectedState,
      port: 0,
      timeoutMs: 2_000,
    });
    const callbackUrl = `${server.redirectUrl}?code=${encodeURIComponent(syntheticValue())}&state=${encodeURIComponent(expectedState)}`;

    assert.equal((await fetch(callbackUrl)).status, 200);
    await server.callback;
    await assert.rejects(fetch(callbackUrl));
  });

  it("rejects and releases the port when explicitly closed", async () => {
    const server = await startLocalOAuthCallbackServer({
      expectedState: syntheticValue(),
      port: 0,
      timeoutMs: 2_000,
    });
    const callbackRejection = assert.rejects(
      server.callback,
      { name: "OAuthCallbackClosedError" },
    );

    await server.close();
    await callbackRejection;
    await assert.rejects(fetch(server.redirectUrl));
  });

  it("times out and releases the callback port", async () => {
    const server = await startLocalOAuthCallbackServer({
      expectedState: syntheticValue(),
      port: 0,
      timeoutMs: 20,
    });

    await assert.rejects(server.callback, { name: "OAuthCallbackTimeoutError" });
    await assert.rejects(fetch(server.redirectUrl));
  });
});

describe("runLocalOAuthBootstrap", () => {
  it("persists an interactive bootstrap and reuses it without reopening the browser", async () => {
    const authorizationCode = syntheticValue();
    const repository = new InMemoryCredentialRepository();
    const authorize: OAuthAuthorizationDriver = async (
      provider: OAuthClientProvider,
      receivedCode?: string,
    ) => {
      if ((await provider.tokens()) !== undefined) return "AUTHORIZED";
      if (receivedCode === undefined) {
        await provider.saveDiscoveryState?.({
          authorizationServerUrl: "https://synthetic.invalid",
        });
        await provider.saveClientInformation?.({ client_id: syntheticValue() });
        await provider.saveCodeVerifier(syntheticValue());
        const state = await provider.state?.();
        void fetch(
          `${String(provider.redirectUrl)}?code=${encodeURIComponent(authorizationCode)}&state=${encodeURIComponent(String(state))}`,
        );
        return "REDIRECT";
      }
      assert.equal(receivedCode, authorizationCode);
      await provider.saveTokens({
        access_token: syntheticValue(),
        refresh_token: syntheticValue(),
        expires_in: 3600,
        token_type: "Bearer",
      });
      return "AUTHORIZED";
    };

    const [firstClientTransport, firstServerTransport] = InMemoryTransport.createLinkedPair();
    const firstServer = new McpServer({ name: "synthetic-server", version: "1.0.0" });
    firstServer.registerTool("read_only_probe", {}, async () => ({ content: [] }));
    await firstServer.connect(firstServerTransport);
    const first = await runLocalOAuthBootstrapWithDependencies({
      repository,
      authorize,
      openAuthorizationUrl: async () => undefined,
      transportFactory: (_serverUrl, provider) => {
        assert.throws(() => provider.state?.());
        assert.throws(() => provider.codeVerifier());
        return firstClientTransport;
      },
      callbackPort: 0,
      callbackTimeoutMs: 2_000,
    });
    await firstServer.close();

    const [secondClientTransport, secondServerTransport] = InMemoryTransport.createLinkedPair();
    const secondServer = new McpServer({ name: "synthetic-server", version: "1.0.0" });
    secondServer.registerTool("read_only_probe", {}, async () => ({ content: [] }));
    await secondServer.connect(secondServerTransport);
    const second = await runLocalOAuthBootstrapWithDependencies({
      repository,
      authorize,
      openAuthorizationUrl: async () => {
        throw new Error("browser must not open");
      },
      transportFactory: () => secondClientTransport,
      callbackPort: 0,
      callbackTimeoutMs: 2_000,
    });
    await secondServer.close();

    assert.equal(first.state, "CONNECTED");
    assert.equal(first.evidence.callbackAccepted, true);
    assert.equal(first.evidence.credentialsPersisted, true);
    assert.equal(first.evidence.clientRegistrationPersisted, true);
    assert.equal(second.state, "CONNECTED");
    assert.equal(second.evidence.resultCategory, "STORED_CREDENTIAL_REUSED");
    assert.equal(second.evidence.callbackAccepted, false);
    assert.equal(second.evidence.toolCount, 1);
    assert.equal(JSON.stringify([first, second]).includes(authorizationCode), false);
  });
});
