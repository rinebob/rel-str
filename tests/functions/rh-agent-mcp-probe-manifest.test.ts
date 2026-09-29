import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatProbePlan,
  loadProbeManifest,
  validateProbeManifest,
} from "../../functions/src/rh-agent-mcp/diagnostics/probe-manifest";
import type { RobinhoodToolDefinition } from "../../shared/robinhood-mcp-contracts";

const REPO_TMP = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".devin",
  "tmp",
  "test-probe-manifest",
);

const knownTools: RobinhoodToolDefinition[] = [
  {
    name: "get_accounts",
    description: "List accounts",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    mutation: false,
    category: "Account & Performance",
  },
  {
    name: "get_portfolio",
    description: "Portfolio snapshot",
    inputSchema: {
      type: "object",
      required: ["account_number"],
      properties: { account_number: { type: "string" } },
      additionalProperties: false,
    },
    mutation: false,
    category: "Account & Performance",
  },
  {
    name: "place_equity_order",
    description: "Place an equity order",
    inputSchema: {
      type: "object",
      required: ["account_number", "symbol", "side", "type"],
      properties: {
        account_number: { type: "string" },
        symbol: { type: "string" },
        side: { type: "string" },
        type: { type: "string" },
        quantity: { type: "string" },
        tax_lots: { type: "array" },
      },
      additionalProperties: false,
    },
    mutation: true,
    financialMutation: true,
    category: "Orders",
  },
  {
    // Not in the static MUTATION_TOOLS name set — mutation only via flag.
    name: "flagged_only_mutation",
    description: "Mutation known only via definition.mutation",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    mutation: true,
  },
];

const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "probe-1",
  tool: "get_accounts",
  args: {},
  group: "account",
  gate: "read",
  ...over,
});

const manifest = (probes: unknown[]) => ({ probes });

describe("probe manifest loader/validator", () => {
  it("loads a valid manifest and annotates required env vars", () => {
    const result = validateProbeManifest(
      manifest([
        entry(),
        entry({
          id: "probe-2",
          tool: "get_portfolio",
          args: { account_number: "$ENV:RH_ACCOUNT_NUMBER" },
          group: "account",
        }),
        entry({
          id: "probe-3",
          tool: "place_equity_order",
          gate: "mutation",
          args: {
            account_number: "$ENV:RH_ACCOUNT_NUMBER",
            symbol: "OOMA",
            side: "buy",
            type: "market",
            quantity: "1",
          },
          note: "resting order probe",
          redactFields: ["account_number"],
        }),
      ]),
      { knownTools },
    );
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.entries.length, 3);
    assert.deepEqual(result.entries[1].requiredEnv, ["RH_ACCOUNT_NUMBER"]);
    assert.equal(result.entries[2].note, "resting order probe");
  });

  it("rejects a manifest with no probes array", () => {
    const result = validateProbeManifest({ notProbes: [] }, { knownTools });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("probes")));
  });

  it("accepts an empty probes array as valid-but-empty", () => {
    const result = validateProbeManifest(manifest([]), { knownTools });
    assert.equal(result.ok, true);
    assert.equal(result.entries.length, 0);
  });

  it("rejects a non-object probe entry", () => {
    const result = validateProbeManifest(manifest([null, 42, "x"]), {
      knownTools,
    });
    assert.equal(result.ok, false);
    assert.equal(result.entries.length, 0);
    assert.equal(result.errors.length, 3);
  });

  it("errors on an unknown tool, naming it", () => {
    const result = validateProbeManifest(
      manifest([entry({ tool: "get_nonsense" })]),
      { knownTools },
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("get_nonsense")));
    assert.equal(result.entries.length, 0);
  });

  it("errors on duplicate ids", () => {
    const result = validateProbeManifest(
      manifest([entry(), entry()]),
      { knownTools },
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("probe-1")));
  });

  it("errors on missing or invalid gate", () => {
    for (const gate of [undefined, "yolo", 1]) {
      const result = validateProbeManifest(
        manifest([entry({ gate })]),
        { knownTools },
      );
      assert.equal(result.ok, false, `gate=${String(gate)}`);
      assert.ok(result.errors.some((e) => e.message.includes("gate")));
    }
  });

  it("errors when a mutation tool is gated 'read' (unattended mutation is unsafe)", () => {
    const result = validateProbeManifest(
      manifest([
        entry({
          id: "bad-gate",
          tool: "place_equity_order",
          gate: "read",
          args: { account_number: "$ENV:X", symbol: "OOMA", side: "buy", type: "market" },
        }),
      ]),
      { knownTools },
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("bad-gate")));
    assert.equal(result.entries.length, 0);
  });

  it("errors when a flag-marked mutation tool absent from the static set is gated 'read'", () => {
    const result = validateProbeManifest(
      manifest([entry({ tool: "flagged_only_mutation", gate: "read" })]),
      { knownTools },
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("gated 'read'")));
  });

  it("warns (not errors) when a read-only tool is over-gated 'mutation'", () => {
    const result = validateProbeManifest(
      manifest([entry({ gate: "mutation" })]),
      { knownTools },
    );
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some((w) => w.message.includes("probe-1")));
    assert.equal(result.entries.length, 1);
  });

  it("errors when args is missing or not a plain object", () => {
    for (const args of [undefined, ["not", "an", "object"], "x"]) {
      const result = validateProbeManifest(
        manifest([entry({ args })]),
        { knownTools },
      );
      assert.equal(result.ok, false, `args=${JSON.stringify(args)}`);
      assert.ok(result.errors.some((e) => e.message.includes("args")));
    }
  });

  it("errors when args fail the tool's inputSchema at load time", () => {
    const result = validateProbeManifest(
      manifest([
        entry({
          id: "bad-args",
          tool: "get_portfolio",
          // bogus_param is unknown to the schema -> explicit unknown-key error;
          // missing account_number is the schema-level failure.
          args: { bogus_param: "x" },
        }),
      ]),
      { knownTools },
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("bad-args")));
    assert.ok(result.errors.some((e) => e.message.includes("bogus_param")));
  });

  it("rejects a typo'd optional param instead of silently stripping it", () => {
    const result = validateProbeManifest(
      manifest([
        entry({
          id: "typo-arg",
          tool: "get_portfolio",
          // valid required arg + a misspelled extra key the schema doesn't know
          args: { account_number: "$ENV:X", acount_number: "123" },
        }),
      ]),
      { knownTools },
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("acount_number")));
  });

  it("rejects malformed $ENV: placeholders (lowercase, partial, prefixed)", () => {
    for (const bad of ["$ENV:lowercase_name", "$ENV:", "prefix-$ENV:X"]) {
      const result = validateProbeManifest(
        manifest([
          entry({ tool: "get_portfolio", args: { account_number: bad } }),
        ]),
        { knownTools },
      );
      assert.equal(result.ok, false, bad);
      assert.ok(
        result.errors.some((e) => e.message.includes("malformed $ENV")),
        bad,
      );
    }
  });

  it("rejects a malformed $ENV placeholder nested inside array args", () => {
    const result = validateProbeManifest(
      manifest([
        entry({
          tool: "place_equity_order",
          gate: "mutation",
          args: {
            account_number: "$ENV:A",
            symbol: "OOMA",
            side: "buy",
            type: "market",
            tax_lots: [{ open_lot_id: "$ENV:lowercase", quantity: "1" }],
          },
        }),
      ]),
      { knownTools },
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("malformed $ENV")));
  });

  it("allows extra keys when the schema permits additionalProperties", () => {
    const loose: RobinhoodToolDefinition[] = [
      {
        name: "get_accounts",
        description: "",
        inputSchema: { type: "object", properties: {}, additionalProperties: true },
        mutation: false,
      },
    ];
    const result = validateProbeManifest(
      manifest([entry({ args: { anything_goes: 1 } })]),
      { knownTools: loose },
    );
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it("honors patternProperties when checking for unknown arg keys", () => {
    const patterned: RobinhoodToolDefinition[] = [
      {
        name: "get_accounts",
        description: "",
        inputSchema: {
          type: "object",
          properties: {},
          patternProperties: { "^x-": { type: "string" } },
          additionalProperties: false,
        },
        mutation: false,
      },
    ];
    const ok = validateProbeManifest(
      manifest([entry({ args: { "x-custom": "v" } })]),
      { knownTools: patterned },
    );
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    const bad = validateProbeManifest(
      manifest([entry({ args: { "xno-dash": "v" } })]),
      { knownTools: patterned },
    );
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.message.includes("xno-dash")));
  });

  it("rejects non-filename-safe probe ids", () => {
    for (const id of ["../escape", "a/b", "has space"]) {
      const result = validateProbeManifest(
        manifest([entry({ id })]),
        { knownTools },
      );
      assert.equal(result.ok, false, id);
      assert.ok(result.errors.some((e) => e.message.includes("filename-safe")));
    }
  });

  it("resolves server-prefixed tool names in the injected tool set", () => {
    const prefixed: RobinhoodToolDefinition[] = [
      { name: "mcp__robinhood-trading__get_accounts", description: "", inputSchema: { type: "object", properties: {} }, mutation: false },
    ];
    const result = validateProbeManifest(manifest([entry()]), { knownTools: prefixed });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.entries.length, 1);
  });

  it("collects every requiredEnv placeholder across nested args", () => {
    const result = validateProbeManifest(
      manifest([
        entry({
          tool: "place_equity_order",
          gate: "mutation",
          args: {
            account_number: "$ENV:RH_ACCOUNT_NUMBER",
            symbol: "OOMA",
            side: "buy",
            type: "market",
            tax_lots: [{ open_lot_id: "$ENV:RH_TEST_LOT", quantity: "1" }],
          },
        }),
      ]),
      { knownTools },
    );
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.entries[0].requiredEnv.sort(), [
      "RH_ACCOUNT_NUMBER",
      "RH_TEST_LOT",
    ]);
  });

  it("errors on non-string redactFields / note", () => {
    const result = validateProbeManifest(
      manifest([
        entry({ redactFields: [123] }),
        entry({ id: "p2", note: 5 }),
      ]),
      { knownTools },
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.length >= 2);
    assert.equal(result.entries.length, 0);
  });

  it("formatProbePlan lists probes in order with gate + tool", () => {
    const result = validateProbeManifest(
      manifest([
        entry(),
        entry({ id: "probe-2", tool: "place_equity_order", gate: "mutation",
          args: { account_number: "$ENV:A", symbol: "OOMA", side: "buy", type: "market" } }),
      ]),
      { knownTools },
    );
    const plan = formatProbePlan(result.entries);
    const lines = plan.split("\n");
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes("read") && lines[0].includes("probe-1") && lines[0].includes("get_accounts"));
    assert.ok(lines[1].includes("mutation") && lines[1].includes("probe-2") && lines[1].includes("place_equity_order"));
  });

  it("loadProbeManifest reads a JSON file and reports a missing file as an error result", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const good = join(REPO_TMP, "good.json");
      writeFileSync(good, JSON.stringify(manifest([entry()])));
      const okResult = await loadProbeManifest(good, { knownTools });
      assert.equal(okResult.ok, true);
      assert.equal(okResult.entries.length, 1);

      const missing = await loadProbeManifest(join(REPO_TMP, "nope.json"), { knownTools });
      assert.equal(missing.ok, false);
      assert.ok(missing.errors[0].message.includes("nope.json"));

      const badJson = join(REPO_TMP, "bad.json");
      writeFileSync(badJson, "{ not json");
      const badResult = await loadProbeManifest(badJson, { knownTools });
      assert.equal(badResult.ok, false);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("defaults to the bundled tool catalog for known tools when none injected", async () => {
    const result = await loadProbeManifest(
      join(REPO_TMP, "unused.json"),
      { data: manifest([entry()]) },
    );
    assert.equal(result.ok, true);
    const bad = await loadProbeManifest(join(REPO_TMP, "unused.json"), {
      data: manifest([entry({ tool: "totally_fake_tool" })]),
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.message.includes("totally_fake_tool")));
  });
});
