import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryTransport } from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js";
import type { OAuthClientProvider } from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js";
import { McpServer } from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import {
  RobinhoodMcpSession,
  type RobinhoodMcpTransportFactory,
} from "../../functions/src/rh-agent-mcp/index";

function createProvider(): OAuthClientProvider {
  return {
    redirectUrl: "http://127.0.0.1:3456/callback",
    clientMetadata: {
      redirect_uris: ["http://127.0.0.1:3456/callback"],
    },
    clientInformation: async () => undefined,
    tokens: async () => undefined,
    saveTokens: async () => undefined,
    redirectToAuthorization: async () => undefined,
    saveCodeVerifier: async () => undefined,
    codeVerifier: async () => "synthetic-code-verifier",
  };
}

describe("RobinhoodMcpSession", () => {
  it("connects, lists tools, and closes through the SDK composition", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "synthetic-server", version: "1.0.0" });
    server.registerTool("read_only_probe", {}, async () => ({ content: [] }));
    await server.connect(serverTransport);
    const session = new RobinhoodMcpSession(
      createProvider(),
      () => clientTransport,
    );

    try {
      await session.connect();
      assert.equal(await session.listTools(), 1);
    } finally {
      await session.close();
      await server.close();
    }

    await assert.rejects(session.listTools(), { name: "McpSessionNotConnectedError" });
  });

  it("surfaces a transport close failure without leaving the session connected", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "synthetic-server", version: "1.0.0" });
    await server.connect(serverTransport);
    const originalClose = clientTransport.close.bind(clientTransport);
    clientTransport.close = async () => {
      await originalClose();
      throw new Error("synthetic close failure");
    };
    const session = new RobinhoodMcpSession(createProvider(), () => clientTransport);

    await session.connect();
    await assert.rejects(session.close());
    await assert.rejects(session.listTools(), { name: "McpSessionNotConnectedError" });
    await server.close();
  });

  it("closes a transport when connection fails", async () => {
    let closeCount = 0;
    const createTransport: RobinhoodMcpTransportFactory = () => ({
      start: async () => {
        throw new Error("synthetic connection failure");
      },
      send: async () => undefined,
      close: async () => {
        closeCount += 1;
      },
    });
    const session = new RobinhoodMcpSession(createProvider(), createTransport);

    await assert.rejects(session.connect());
    assert.equal(closeCount, 1);
    await session.close();
    assert.equal(closeCount, 1);
  });
});
