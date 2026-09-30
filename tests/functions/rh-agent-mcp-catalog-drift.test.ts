import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  diffToolCatalog,
  type DriftToolEntry,
} from "../../functions/src/rh-agent-mcp/diagnostics/catalog-drift";

const tool = (
  name: string,
  inputSchema: Record<string, unknown> = { type: "object", properties: {} },
  description = `desc of ${name}`,
): DriftToolEntry => ({ name, description, inputSchema });

describe("catalog drift diff", () => {
  it("reports no drift when live matches catalog", () => {
    const tools = [
      tool("get_accounts"),
      tool("get_portfolio", {
        type: "object",
        required: ["account_number"],
        properties: { account_number: { type: "string" } },
        additionalProperties: false,
      }),
    ];
    const drift = diffToolCatalog(tools, tools);
    assert.deepEqual(drift.added, []);
    assert.deepEqual(drift.removed, []);
    assert.deepEqual(drift.possiblyRenamed, []);
    assert.deepEqual(drift.changed, []);
    assert.deepEqual(drift.unchanged.sort(), ["get_accounts", "get_portfolio"]);
    assert.equal(drift.hasDrift, false);
  });

  it("reports added + removed tools, prefixed live names normalized", () => {
    const drift = diffToolCatalog(
      [
        tool("mcp__robinhood-trading__get_accounts", undefined, "desc of get_accounts"),
        tool("mcp__robinhood-trading__get_new_tool"),
      ],
      [tool("get_accounts"), tool("get_old_tool")],
    );
    assert.deepEqual(drift.added, ["get_new_tool"]);
    assert.deepEqual(drift.removed, ["get_old_tool"]);
    assert.deepEqual(drift.unchanged, ["get_accounts"]);
    assert.equal(drift.hasDrift, true);
  });

  it("pairs an identical-schema removed+added as a possible rename", () => {
    const schema = {
      type: "object",
      required: ["account_number"],
      properties: { account_number: { type: "string" } },
    };
    const drift = diffToolCatalog(
      [tool("get_portfolio_v2", schema, "same desc")],
      [tool("get_portfolio", schema, "same desc")],
    );
    assert.deepEqual(drift.possiblyRenamed, [
      { from: "get_portfolio", to: "get_portfolio_v2" },
    ]);
    // still also listed as added/removed — rename is a hint, not a merge
    assert.deepEqual(drift.added, ["get_portfolio_v2"]);
    assert.deepEqual(drift.removed, ["get_portfolio"]);
  });

  it("reports a newly-required property as a breaking schema diff", () => {
    const catalog = [
      tool("get_equity_orders", {
        type: "object",
        properties: { account_number: { type: "string" } },
      }),
    ];
    const live = [
      tool("get_equity_orders", {
        type: "object",
        required: ["account_number"],
        properties: { account_number: { type: "string" } },
      }),
    ];
    const drift = diffToolCatalog(live, catalog);
    assert.equal(drift.changed.length, 1);
    const diffs = drift.changed[0].diffs.join("\n");
    assert.ok(diffs.includes("required"));
    assert.ok(diffs.includes("account_number"));
  });

  it("reports added + removed schema properties", () => {
    const catalog = [
      tool("search", {
        type: "object",
        properties: { q: { type: "string" }, stale_param: { type: "number" } },
        additionalProperties: false,
      }),
    ];
    const live = [
      tool("search", {
        type: "object",
        properties: { q: { type: "string" }, limit: { type: "number" } },
        additionalProperties: false,
      }),
    ];
    const drift = diffToolCatalog(live, catalog);
    assert.equal(drift.changed.length, 1);
    const diffs = drift.changed[0].diffs;
    assert.ok(diffs.some((d) => d.includes("+properties.limit")));
    assert.ok(diffs.some((d) => d.includes("-properties.stale_param")));
  });

  it("reports type + enum + additionalProperties changes on shared properties", () => {
    const catalog = [
      tool("get_equity_orders", {
        type: "object",
        properties: {
          state: { type: "string", enum: ["open", "filled"] },
          limit: { type: "string" },
        },
        additionalProperties: false,
      }),
    ];
    const live = [
      tool("get_equity_orders", {
        type: "object",
        properties: {
          state: { type: "string", enum: ["open", "filled", "queued"] },
          limit: { type: "number" },
        },
        additionalProperties: true,
      }),
    ];
    const drift = diffToolCatalog(live, catalog);
    assert.equal(drift.changed.length, 1);
    const diffs = drift.changed[0].diffs.join("\n");
    assert.ok(diffs.includes("state") && diffs.includes("enum"));
    assert.ok(diffs.includes("properties.limit.type") && diffs.includes('"string" -> "number"'));
    assert.ok(diffs.includes("additionalProperties"));
  });

  it("reports description changes at tool level", () => {
    const drift = diffToolCatalog(
      [tool("get_accounts", undefined, "new desc")],
      [tool("get_accounts", undefined, "old desc")],
    );
    assert.equal(drift.changed.length, 1);
    assert.ok(drift.changed[0].diffs[0].includes("description"));
  });

  it("counts both sides and records timestamps/catalog metadata", () => {
    const drift = diffToolCatalog(
      [tool("a"), tool("b")],
      [tool("a")],
      { catalogGenerated: "2026-07-17", catalogSource: "tools/list dump" },
    );
    assert.equal(drift.liveToolCount, 2);
    assert.equal(drift.catalogToolCount, 1);
    assert.equal(drift.catalogGenerated, "2026-07-17");
    assert.ok(drift.generatedAt.length > 0);
  });

  it("array-valued type (['null','array']) does not produce a phantom diff", () => {
    const schema = {
      type: "object",
      properties: { symbols: { type: ["null", "array"] } },
    };
    const drift = diffToolCatalog([tool("get_quotes", schema)], [tool("get_quotes", schema)]);
    assert.deepEqual(drift.changed, []);
    assert.equal(drift.hasDrift, false);
  });

  it("array-valued type change IS reported when values differ", () => {
    const drift = diffToolCatalog(
      [tool("x", { type: "object", properties: { p: { type: ["string", "null"] } } })],
      [tool("x", { type: "object", properties: { p: { type: ["number", "null"] } } })],
    );
    assert.equal(drift.changed.length, 1);
    assert.ok(drift.changed[0].diffs.some((d) => d.includes("properties.p.type")));
  });

  it("enum reorder produces no phantom diff (sets, not sequences)", () => {
    const catalog = [tool("x", { type: "object", properties: { s: { type: "string", enum: ["a", "b"] } } })];
    const live = [tool("x", { type: "object", properties: { s: { type: "string", enum: ["b", "a"] } } })];
    const drift = diffToolCatalog(live, catalog);
    assert.deepEqual(drift.changed, []);
  });

  it("array-valued type reorder produces no phantom diff", () => {
    const catalog = [tool("x", { type: "object", properties: { s: { type: ["null", "array"] } } })];
    const live = [tool("x", { type: "object", properties: { s: { type: ["array", "null"] } } })];
    const drift = diffToolCatalog(live, catalog);
    assert.deepEqual(drift.changed, []);
  });

  it("nested required reorder inside a property subschema is unchanged", () => {
    const catalog = [tool("x", {
      type: "object",
      properties: { filter: { type: "object", required: ["a", "b"], properties: {} } },
    })];
    const live = [tool("x", {
      type: "object",
      properties: { filter: { required: ["b", "a"], properties: {}, type: "object" } },
    })];
    const drift = diffToolCatalog(live, catalog);
    assert.deepEqual(drift.changed, []);
  });

  it("type added/removed on a property is reported", () => {
    const catalog = [tool("x", { type: "object", properties: { s: { description: "d" } } })];
    const live = [tool("x", { type: "object", properties: { s: { type: "string", description: "d" } } })];
    const drift = diffToolCatalog(live, catalog);
    assert.equal(drift.changed.length, 1);
    assert.ok(drift.changed[0].diffs.some((d) => d.includes("properties.s.type")));
  });

  it("scalar type vs single-element array is equivalent (JSON Schema)", () => {
    const catalog = [tool("x", { type: "object", properties: { s: { type: "string" } } })];
    const live = [tool("x", { type: "object", properties: { s: { type: ["string"] } } })];
    const drift = diffToolCatalog(live, catalog);
    assert.deepEqual(drift.changed, []);
  });

  it("oneOf reorder (array of schema objects) produces no phantom diff", () => {
    const catalog = [tool("x", { type: "object", properties: { s: { oneOf: [{ type: "a" }, { type: "b" }] } } })];
    const live = [tool("x", { type: "object", properties: { s: { oneOf: [{ type: "b" }, { type: "a" }] } } })];
    const drift = diffToolCatalog(live, catalog);
    assert.deepEqual(drift.changed, []);
  });

  it("a constraint change alongside a leaf diff still surfaces", () => {
    const catalog = [tool("x", { type: "object", properties: { s: { type: "string", minimum: 0 } } })];
    const live = [tool("x", { type: "object", properties: { s: { type: "number", minimum: 5 } } })];
    const drift = diffToolCatalog(live, catalog);
    const diffs = drift.changed[0].diffs.join("\n");
    assert.ok(diffs.includes("properties.s.type"));
    assert.ok(diffs.includes("other fields changed"));
  });

  it("a reordered non-set array (default list) IS a real diff", () => {
    const catalog = [tool("x", { type: "object", properties: { s: { default: ["a", "b"] } } })];
    const live = [tool("x", { type: "object", properties: { s: { default: ["b", "a"] } } })];
    const drift = diffToolCatalog(live, catalog);
    assert.equal(drift.changed.length, 1);
  });

  it("a property named `constructor` removed from live reports once, not twice", () => {
    const catalog = [tool("x", { type: "object", properties: { constructor: { type: "string" }, ok: {} } })];
    const live = [tool("x", { type: "object", properties: { ok: {} } })];
    const drift = diffToolCatalog(live, catalog);
    assert.equal(drift.changed.length, 1);
    assert.deepEqual(drift.changed[0].diffs, ["-properties.constructor"]);
  });

  it("collision-only diff sets hasDrift", () => {
    const drift = diffToolCatalog(
      [tool("get_accounts"), tool("mcp__robinhood-trading__get_accounts")],
      [tool("get_accounts")],
    );
    assert.equal(drift.hasDrift, true);
    assert.deepEqual(drift.nameCollisions, ["get_accounts"]);
  });

  it("root-level schema changes outside properties/required are caught", () => {
    const catalog = [tool("x", { type: "object", properties: { a: { type: "string" } }, minProperties: 0 })];
    const live = [tool("x", { type: "object", properties: { a: { type: "string" } }, minProperties: 1 })];
    const drift = diffToolCatalog(live, catalog);
    assert.equal(drift.changed.length, 1);
    assert.ok(drift.changed[0].diffs.some((d) => d.includes("root changed")));
  });

  it("rename pairing emits every matching candidate (ambiguity is signal)", () => {
    const schema = { type: "object", properties: {} };
    const drift = diffToolCatalog(
      [tool("new_a", schema, "shared desc"), tool("new_b", schema, "shared desc")],
      [tool("old_x", schema, "shared desc")],
    );
    assert.equal(drift.possiblyRenamed.length, 2);
    assert.ok(
      drift.possiblyRenamed.every((p) => p.from === "old_x"),
    );
  });

  it("prefixed+unprefixed dup in one list surfaces as a name collision", () => {
    const drift = diffToolCatalog(
      [tool("get_accounts"), tool("mcp__robinhood-trading__get_accounts")],
      [tool("get_accounts")],
    );
    assert.deepEqual(drift.nameCollisions, ["get_accounts"]);
    assert.equal(drift.liveToolCount, 1);
  });

  it("an empty live list reports every catalog tool as removed", () => {
    const drift = diffToolCatalog([], [tool("a"), tool("b")]);
    assert.deepEqual(drift.removed.sort(), ["a", "b"]);
    assert.equal(drift.hasDrift, true);
  });

  it("same-name tools with semantically equal but order-shuffled schemas are unchanged", () => {
    const live = [
      tool("get_accounts", {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "number" } },
        required: ["a", "b"],
      }),
    ];
    const catalog = [
      tool("get_accounts", {
        required: ["b", "a"],
        properties: { b: { type: "number" }, a: { type: "string" } },
        type: "object",
      }),
    ];
    const drift = diffToolCatalog(live, catalog);
    assert.deepEqual(drift.changed, []);
    assert.deepEqual(drift.unchanged, ["get_accounts"]);
  });
});
