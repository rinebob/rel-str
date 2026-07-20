import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryTransport } from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js";
import { McpServer } from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import type { RobinhoodCredentialBundle } from "../../functions/src/rh-agent-mcp/index";
import { executeObservationTool } from "../../functions/src/rh-agent-mcp/tools/robinhood-tool-executor";
import {
  FULL_DISCOVERY_STATE,
  InMemoryCredentialRepository,
} from "./rh-agent-mcp-token-refresh-fixtures";

describe("executeObservationTool", () => {
  function createRepository(credential: RobinhoodCredentialBundle | null = null) {
    return new InMemoryCredentialRepository(credential);
  }

  it("executes an allowlisted read-only tool and redacts the response", async () => {
    const credential: RobinhoodCredentialBundle = {
      schemaVersion: 1,
      revision: 1,
      tokens: {
        access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      },
      clientInformation: { client_id: "synthetic-client" },
      discoveryState: FULL_DISCOVERY_STATE,
      lastTokenResponseAt: new Date().toISOString(),
    };
    const repository = createRepository(credential);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "synthetic-server", version: "1.0.0" });
    server.registerTool(
      "get_accounts",
      {},
      async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify([
              {
                account_number: "1234567890",
                first_name: "Alice",
                type: "margin",
              },
            ]),
          },
        ],
      }),
    );
    await server.connect(serverTransport);

    try {
      const result = await executeObservationTool(
        "get_accounts",
        {},
        {},
        {
          transportFactory: () => clientTransport,
          repository,
        },
      );

      assert.equal(result.success, true);
      const typed = result as Extract<typeof result, { success: true }>;
      assert.ok(Array.isArray(typed.parsed));
      const redactedArray = typed.redacted as Array<Record<string, unknown>>;
      assert.equal(redactedArray[0].account_number, "••••7890");
      assert.equal(redactedArray[0].first_name, "A•••e");
      assert.equal(redactedArray[0].type, "margin");
    } finally {
      await server.close();
    }
  });

  it("rejects tools outside the observation allowlist", async () => {
    const result = await executeObservationTool(
      "unknown_tool",
      {},
    );

    assert.equal(result.success, false);
    if (result.success === false) {
      assert.ok(result.error.includes("not in the observation allowlist"));
      assert.equal(result.category, "VALIDATION");
    }
  });

  it("rejects non-object arguments", async () => {
    const result = await executeObservationTool(
      "get_accounts",
      "invalid",
    );

    assert.equal(result.success, false);
    if (result.success === false) {
      assert.ok(result.error.includes("JSON object"));
      assert.equal(result.category, "VALIDATION");
    }
  });
});
