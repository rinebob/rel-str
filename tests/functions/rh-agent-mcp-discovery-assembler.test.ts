import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleDiscoveryDoc,
  buildFieldTree,
  renderFieldTree,
  safetyClass,
  type AssemblerInput,
  type CaptureRecord,
  type LiveTool,
  type ManifestProbe,
} from "../../functions/src/rh-agent-mcp/diagnostics/assemble-discovery-doc";

const TOOLS: LiveTool[] = [
  {
    name: "get_equity_quotes",
    description: "Quotes for symbols.",
    inputSchema: {
      type: "object",
      properties: {
        symbols: { type: "string", description: "Comma-separated or array." },
        cursor: { type: "string" },
      },
      required: ["symbols"],
    },
  },
  {
    name: "place_equity_order",
    description: "Place an equity order.",
    inputSchema: {
      type: "object",
      properties: {
        account_number: { type: "string" },
        symbol: { type: "string" },
        side: { type: "string" },
      },
      required: ["account_number", "symbol", "side"],
    },
  },
  {
    name: "never_probed_tool",
    description: "No probes anywhere.",
    inputSchema: { type: "object", properties: {} },
  },
];

const PROBES: ManifestProbe[] = [
  { id: "ro-q-01", tool: "get_equity_quotes", args: { symbols: "OOMA" }, group: "g", gate: "read", note: "single quote" },
  { id: "ro-q-02", tool: "get_equity_quotes", args: { symbols: "OOMA", cursor: "abc" }, group: "g", gate: "read" },
  { id: "mx-buy-01", tool: "place_equity_order", args: { symbol: "OOMA" }, group: "g", gate: "mutation" },
];

const CAPTURES: CaptureRecord[] = [
  {
    id: "ro-q-01",
    tool: "get_equity_quotes",
    args: { symbols: "OOMA" },
    outcome: "success",
    capturedAt: "2026-10-05T00:00:00Z",
    note: "single quote",
    response: {
      data: {
        results: [
          { quote: { symbol: "OOMA", last_trade_price: "20.91", adjusted_previous_close: null } },
        ],
        next: null,
      },
    },
  },
  {
    id: "ro-q-02",
    tool: "get_equity_quotes",
    args: { symbols: "OOMA", cursor: "abc" },
    outcome: "error",
    capturedAt: "2026-10-05T00:00:01Z",
    response: { error: { code: "bad_cursor", message: "nope" } },
  },
];

function input(over: Partial<AssemblerInput> = {}): AssemblerInput {
  return {
    tools: TOOLS,
    probes: PROBES,
    captures: CAPTURES,
    generatedAt: "2026-10-05T00:00:00Z",
    ...over,
  };
}

describe("safetyClass", () => {
  it("classifies by tool-name convention", () => {
    assert.equal(safetyClass("get_accounts"), "read-only");
    assert.equal(safetyClass("review_equity_order"), "simulation");
    assert.equal(safetyClass("preview_crypto_order"), "simulation");
    assert.equal(safetyClass("place_equity_order"), "financial mutation");
    assert.equal(safetyClass("cancel_equity_order"), "financial mutation");
    assert.equal(safetyClass("exercise_option"), "financial mutation");
    assert.equal(safetyClass("create_watchlist"), "account write");
    assert.equal(safetyClass("delete_alert"), "account write");
    assert.equal(safetyClass("run_scan"), "read-only");
  });
});

describe("field tree", () => {
  it("walks response JSON into path -> type union", () => {
    const tree = buildFieldTree([
      { a: { b: "x", c: null }, list: [1, 2] },
      { a: { b: "y", c: 3 }, list: [] },
    ]);
    const rendered = renderFieldTree(tree);
    assert.match(rendered, /`a`: object/);
    assert.match(rendered, /`b`: string/);
    assert.match(rendered, /`c`: (null \| number|number \| null)/);
    assert.match(rendered, /`list`: array<number>/);
  });

  it("unions scalar types across captures", () => {
    const tree = buildFieldTree([{ x: "s" }, { x: null }]);
    assert.match(renderFieldTree(tree), /`x`: (string \| null|null \| string)/);
  });
});

describe("assembleDiscoveryDoc", () => {
  const doc = assembleDiscoveryDoc(input());

  it("emits a coverage matrix row per live tool", () => {
    assert.match(doc, /\| get_equity_quotes \|/);
    assert.match(doc, /\| place_equity_order \|/);
    assert.match(doc, /\| never_probed_tool \|/);
  });

  it("marks probed/error-only/unprobed/missing statuses correctly", () => {
    const row = (name: string) =>
      doc.split("\n").find((l) => l.startsWith(`| ${name} `))!;
    assert.match(row("get_equity_quotes"), /probed/);
    assert.match(row("place_equity_order"), /unprobed/);
    assert.match(row("never_probed_tool"), /missing/);
  });

  it("renders a params table from the live inputSchema", () => {
    const section = doc.slice(doc.indexOf("### get_equity_quotes"));
    assert.match(section, /\| symbols \| string \| yes \|/);
    assert.match(section, /\| cursor \| string \| no \|/);
  });

  it("renders a response field tree from success captures only", () => {
    const section = doc.slice(doc.indexOf("### get_equity_quotes"));
    assert.match(section, /`results`: array/);
    assert.match(section, /`adjusted_previous_close`: null/);
  });

  it("links every capture for the tool", () => {
    const section = doc.slice(doc.indexOf("### get_equity_quotes"));
    assert.match(section, /captures\/ro-q-01\.json/);
    assert.match(section, /captures\/ro-q-02\.json/);
    assert.match(section, /error/);
  });

  it("carries manifest notes into the tool section", () => {
    const section = doc.slice(doc.indexOf("### get_equity_quotes"));
    assert.match(section, /single quote/);
  });

  it("renders a drift section when drift input is present", () => {
    const withDrift = assembleDiscoveryDoc(
      input({
        drift: {
          generatedAt: "2026-09-30T00:00:00Z",
          liveToolCount: 76,
          catalogToolCount: 49,
          added: ["a", "b"],
          removed: [],
          possiblyRenamed: [{ from: "old_name", to: "new_name" }],
          changed: [{ tool: "c", diffs: ["properties.x.type: string -> number"] }],
          unchanged: ["d"],
          hasDrift: true,
        },
      }),
    );
    assert.match(withDrift, /## Drift/);
    assert.match(withDrift, /76/);
    assert.match(withDrift, /`a`, `b`/);
    assert.match(withDrift, /`old_name→new_name`/);
  });

  it("marks missing-tool sections as unprobed rather than omitting them", () => {
    assert.match(doc, /### never_probed_tool/);
    const section = doc.slice(doc.indexOf("### never_probed_tool"));
    assert.match(section, /no probes|missing/i);
  });

  it("groups tools under their domain headers", () => {
    assert.match(doc, /## Orders/);
    assert.match(doc, /## Market Data & Research/);
  });
});
