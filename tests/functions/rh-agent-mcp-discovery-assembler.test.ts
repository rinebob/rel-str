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
  it("walks response JSON into flat dot-path -> type union", () => {
    const tree = buildFieldTree([
      { a: { b: "x", c: null }, list: [1, 2] },
      { a: { b: "y", c: 3 }, list: [] },
    ]);
    const rendered = renderFieldTree(tree);
    assert.match(rendered, /^a: object$/m);
    assert.match(rendered, /^a\.b: string$/m);
    assert.match(rendered, /^a\.c: (null \| number|number \| null)$/m);
    assert.match(rendered, /^list: array<number>$/m);
  });

  it("unions scalar types across captures", () => {
    const tree = buildFieldTree([{ x: "s" }, { x: null }]);
    assert.match(renderFieldTree(tree), /^x: (string \| null|null \| string)$/m);
  });
});

describe("assembleDiscoveryDoc", () => {
  const docs = assembleDiscoveryDoc(input());
  const doc = docs.main;
  const child = (cat: string) => docs.children.find((c) => c.title === cat)!;
  const marketData = child("Market Data & Research").content;
  const other = child("Other").content;

  it("emits one child doc per category, each linking back to the main doc", () => {
    assert.deepEqual(
      docs.children.map((c) => c.filename).sort(),
      [
        "rh-mcp-tools-market-data-research.md",
        "rh-mcp-tools-orders.md",
        "rh-mcp-tools-other.md",
      ].sort(),
    );
    assert.match(marketData, /# Robinhood MCP — Market Data & Research/);
    assert.match(marketData, /— 1 tools in this group/);
    assert.match(
      marketData,
      /\[canonical tool discovery\]\(rh-mcp-tool-discovery-canonical-657-658-689\.md\)/,
    );
  });

  it("emits a coverage matrix row per live tool, deep-linking into child docs", () => {
    assert.match(doc, /\| \[get_equity_quotes\]\(rh-mcp-tools-market-data-research\.md#get_equity_quotes\) \|/);
    assert.match(doc, /\| \[place_equity_order\]\(rh-mcp-tools-orders\.md#place_equity_order\) \|/);
    assert.match(doc, /\| \[never_probed_tool\]\(rh-mcp-tools-other\.md#never_probed_tool\) \|/);
  });

  it("links each category's child doc in Contents and the matrix group label", () => {
    assert.match(doc, /## Contents/);
    assert.match(doc, /\[Market Data & Research\]\(rh-mcp-tools-market-data-research\.md\) — 1 tools/);
    assert.match(doc, /\[Orders\]\(rh-mcp-tools-orders\.md\) — 1 tools/);
    assert.match(doc, /\[Other\]\(rh-mcp-tools-other\.md\) — 1 tools/);
    const matrix = doc.slice(doc.indexOf("## Coverage matrix"));
    assert.match(matrix, /\*\*Market Data & Research\*\* — 1 tools · \[doc\]\(rh-mcp-tools-market-data-research\.md\)/);
    assert.match(matrix, /\*\*Orders\*\* — 1 tools · \[doc\]\(rh-mcp-tools-orders\.md\)/);
    assert.match(matrix, /\*\*Other\*\* — 1 tools · \[doc\]\(rh-mcp-tools-other\.md\)/);
    assert.match(matrix, /\| tool \| params \(req\/total\) \| probes \| outcomes \| status \|/);
  });

  it("marks probed/error-only/unprobed/missing statuses correctly", () => {
    const row = (name: string) =>
      doc.split("\n").find((l) => l.startsWith(`| [${name}]`))!;
    assert.match(row("get_equity_quotes"), /probed/);
    assert.match(row("place_equity_order"), /unprobed/);
    assert.match(row("never_probed_tool"), /missing/);
  });

  it("renders a params table from the live inputSchema", () => {
    const section = marketData.slice(marketData.indexOf("### get_equity_quotes"));
    assert.match(section, /\| symbols \| string \| yes \|/);
    assert.match(section, /\| cursor \| string \| no \|/);
  });

  it("renders a response shape as a fenced flat dot-path block", () => {
    const section = marketData.slice(marketData.indexOf("### get_equity_quotes"));
    assert.match(section, /\*\*Response shape\*\*/);
    assert.match(section, /```\ndata: object/);
    assert.match(section, /^data\.results: array<object>$/m);
    assert.match(section, /^data\.results\[\]\.quote\.adjusted_previous_close: null$/m);
  });

  it("links every capture for the tool", () => {
    const section = marketData.slice(marketData.indexOf("### get_equity_quotes"));
    assert.match(section, /captures\/ro-q-01\.json/);
    assert.match(section, /captures\/ro-q-02\.json/);
    assert.match(section, /error/);
  });

  it("carries manifest notes into the tool section", () => {
    const section = marketData.slice(marketData.indexOf("### get_equity_quotes"));
    assert.match(section, /single quote/);
  });

  it("renders a drift section in the main doc when drift input is present", () => {
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
    ).main;
    assert.match(withDrift, /## Drift/);
    assert.match(withDrift, /76/);
    assert.match(withDrift, /`a`, `b`/);
    assert.match(withDrift, /`old_name→new_name`/);
  });

  it("marks missing-tool sections as unprobed rather than omitting them", () => {
    assert.match(other, /### never_probed_tool/);
    const section = other.slice(other.indexOf("### never_probed_tool"));
    assert.match(section, /no probes|missing/i);
  });
});
