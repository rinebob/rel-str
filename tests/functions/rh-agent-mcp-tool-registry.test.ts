import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMutationTool,
  isObservationTool,
  listObservationTools,
  loadToolCatalog,
} from "../../functions/src/rh-agent-mcp/tools/robinhood-tools";

describe("Robinhood MCP tool registry", () => {
  it("loads the tool catalog", async () => {
    const catalog = await loadToolCatalog();
    assert.equal(typeof catalog.generated, "string");
    assert.ok(Array.isArray(catalog.tools));
    assert.ok(catalog.tools.length > 0);
  });

  it("returns all enabled observation tools including mutations", async () => {
    const tools = await listObservationTools();
    const names = new Set(tools.map((tool) => tool.name));
    assert.ok(names.has("get_accounts"));
    assert.ok(names.has("get_equity_positions"));
    assert.ok(names.has("place_equity_order"));
    assert.ok(names.has("add_to_watchlist"));
    assert.ok(!names.has("unknown_tool"));
  });

  it("marks mutation tools based on catalog name or description", async () => {
    assert.equal(isMutationTool("place_equity_order"), true);
    assert.equal(isMutationTool("cancel_equity_order"), true);
    assert.equal(isMutationTool("create_watchlist"), true);
  });

  it("does not mark read-only tools as mutations", async () => {
    assert.equal(isMutationTool("get_accounts"), false);
    assert.equal(isMutationTool("get_equity_positions"), false);
  });

  it("identifies observation tools", () => {
    assert.equal(isObservationTool("get_accounts"), true);
    assert.equal(isObservationTool("place_equity_order"), true);
    assert.equal(isObservationTool("unknown_tool"), false);
  });

  it("returns tool definitions with schemas", async () => {
    const tools = await listObservationTools();
    const accounts = tools.find((tool) => tool.name === "get_accounts");
    assert.ok(accounts);
    assert.equal(accounts.mutation, false);
    assert.equal(typeof accounts.description, "string");
    assert.equal(accounts.inputSchema.type, "object");
  });
});
