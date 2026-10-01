import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterProbeEntries,
  findPendingOrders,
  formatAbortChecklist,
  isRateLimitError,
  maskResolvedArgs,
  resolveEnvArgs,
  runProbePlan,
  scrubSecrets,
  type ProbeCallResult,
  type ProbeManifestEntry,
} from "../../functions/src/rh-agent-mcp/diagnostics/probe-runner";
import {
  ToolExecutionErrorCategory,
  type ToolExecutionFailure,
  type ToolExecutionSuccess,
} from "../../shared/robinhood-mcp-contracts";

type TestCallResult =
  | (Omit<ToolExecutionSuccess, "tool"> & { tool?: string })
  | ToolExecutionFailure;

function normalize(r: TestCallResult): ProbeCallResult {
  return r.success ? { tool: "t", ...r } : r;
}

const REPO_TMP = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".devin",
  "tmp",
  "test-probe-runner",
);

const readEntry = (over: Record<string, unknown> = {}): ProbeManifestEntry => ({
  id: "ro-1",
  tool: "get_accounts",
  args: {},
  group: "account",
  gate: "read",
  requiredEnv: [],
  ...over,
});

const mutationEntry = (over: Record<string, unknown> = {}): ProbeManifestEntry => ({
  id: "mut-1",
  tool: "place_equity_order",
  args: {
    account_number: "$ENV:RH_ACCOUNT_NUMBER",
    symbol: "OOMA",
    side: "buy",
    type: "market",
    quantity: "1",
  },
  group: "equity-orders",
  gate: "mutation",
  redactFields: ["account_number"],
  requiredEnv: ["RH_ACCOUNT_NUMBER"],
  ...over,
});

interface FakeHarness {
  calls: Array<{ tool: string; args: Record<string, unknown>; extra?: string[] }>;
  prompts: string[];
  sleeps: number[];
  logs: string[];
  respond: (result: TestCallResult) => void;
  fallback: (result: TestCallResult) => void;
  /** Real-clock delay per call — needed so a tiny settle timeoutMs reliably
   *  crosses the `Date.now()` deadline between polls. */
  delay: (ms: number) => void;
  answer: (a: string) => void;
  run: (entries: ProbeManifestEntry[], over?: Record<string, unknown>) => Promise<{
    aborted: boolean;
    planned: ProbeManifestEntry[];
    captures: unknown[];
  }>;
}

function harness(env: Record<string, string> = { RH_ACCOUNT_NUMBER: "12345678" }): FakeHarness {
  const calls: FakeHarness["calls"] = [];
  const prompts: string[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const queue: ProbeCallResult[] = [];
  const fallbackBox: { v: ProbeCallResult } = {
    v: { success: true, redacted: { ok: true }, parsed: { ok: true }, tool: "t" },
  };
  const answers: string[] = [];
  // 'n' is the fail-closed default — an unscripted prompt must NEVER
  // auto-confirm a mutation.
  const lastAnswer = { v: "n" };
  const delayBox = { v: 0 };
  return {
    calls,
    prompts,
    sleeps,
    logs,
    respond: (r) => queue.push(normalize(r)),
    fallback: (r) => {
      fallbackBox.v = normalize(r);
    },
    delay: (ms) => {
      delayBox.v = ms;
    },
    answer: (a) => {
      answers.push(a);
    },
    run: (entries, over = {}) =>
      runProbePlan({
        entries,
        captureDir: REPO_TMP,
        env,
        caller: async (tool, args, extra) => {
          calls.push({ tool, args, extra });
          if (delayBox.v > 0) {
            await new Promise<void>((r) => setTimeout(r, delayBox.v));
          }
          return queue.length > 0 ? queue.shift()! : fallbackBox.v;
        },
        prompt: async (msg) => {
          prompts.push(msg);
          return answers.length > 0 ? answers.shift()! : lastAnswer.v;
        },
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        log: (l) => logs.push(l),
        ...over,
      }),
  };
}

function readCapture(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO_TMP, `${id}.json`), "utf-8"));
}

describe("probe runner", () => {
  it("writes a success capture with args/latency/success and the REDACTED response", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.respond({
        success: true,
        parsed: { account_number: "12345678", buying_power: "42" },
        redacted: { account_number: "12•••••8", buying_power: "42" },
        tool: "get_accounts",
      });
      const result = await h.run([readEntry()]);
      assert.equal(result.aborted, false);
      const cap = readCapture("ro-1");
      assert.equal(cap.tool, "get_accounts");
      assert.equal(cap.outcome, "success");
      assert.equal(cap.success, true);
      assert.equal(typeof cap.latencyMs, "number");
      // The redacted view is persisted — raw parsed payload never reaches disk.
      assert.deepEqual(cap.response, { account_number: "12•••••8", buying_power: "42" });
      assert.equal(JSON.stringify(cap).includes("12345678"), false);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("resolves $ENV placeholders for the call but keeps them in the capture", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness({ RH_ACCOUNT_NUMBER: "87654321" });
      const entry = readEntry({
        id: "ro-env",
        args: { account_number: "$ENV:RH_ACCOUNT_NUMBER" },
        requiredEnv: ["RH_ACCOUNT_NUMBER"],
      });
      await h.run([entry]);
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0].args.account_number, "87654321");
      const cap = readCapture("ro-env");
      assert.equal(
        (cap.args as Record<string, unknown>).account_number,
        "$ENV:RH_ACCOUNT_NUMBER",
      );
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("skips a probe with a missing env var without calling the tool", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness({}); // RH_ACCOUNT_NUMBER absent
      const entry = readEntry({
        id: "ro-noenv",
        args: { account_number: "$ENV:RH_ACCOUNT_NUMBER" },
        requiredEnv: ["RH_ACCOUNT_NUMBER"],
      });
      const result = await h.run([entry]);
      assert.equal(h.calls.length, 0);
      const cap = readCapture("ro-noenv");
      assert.equal(cap.outcome, "skipped");
      assert.equal(cap.reason, "missing-env");
      assert.ok(JSON.stringify(cap).includes("RH_ACCOUNT_NUMBER"));
      assert.equal(result.aborted, false);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("filters by --only, --group and --from", async () => {
    const entries = [
      readEntry({ id: "a", group: "g1" }),
      readEntry({ id: "b", group: "g1" }),
      readEntry({ id: "c", group: "g2" }),
    ];
    const h = harness();
    let r = await h.run(entries, { only: "b", captureDir: REPO_TMP, dryRun: true });
    assert.deepEqual(r.planned.map((e) => e.id), ["b"]);
    r = await h.run(entries, { group: "g1", captureDir: REPO_TMP, dryRun: true });
    assert.deepEqual(r.planned.map((e) => e.id), ["a", "b"]);
    r = await h.run(entries, { from: "b", captureDir: REPO_TMP, dryRun: true });
    assert.deepEqual(r.planned.map((e) => e.id), ["b", "c"]);
    r = await h.run(entries, { group: "g1", from: "b", captureDir: REPO_TMP, dryRun: true });
    assert.deepEqual(r.planned.map((e) => e.id), ["b"]);
  });

  it("rejects --from with an unknown id", async () => {
    const h = harness();
    await assert.rejects(
      () => h.run([readEntry()], { from: "nope", captureDir: REPO_TMP, dryRun: true }),
      /nope/,
    );
  });

  it("dry-run makes no calls and writes no captures", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      const result = await h.run([readEntry()], { dryRun: true, captureDir: REPO_TMP });
      assert.equal(h.calls.length, 0);
      assert.equal(h.prompts.length, 0);
      assert.equal(existsSync(join(REPO_TMP, "ro-1.json")), false);
      assert.equal(result.planned.length, 1);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("paces read calls (~300ms) but not before the first call", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      const entries = [readEntry({ id: "p1" }), readEntry({ id: "p2" }), readEntry({ id: "p3" })];
      await h.run(entries, { auto: true });
      // 2 pacing sleeps for 3 calls (none before the first).
      assert.deepEqual(h.sleeps, [300, 300]);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("backs off and asks on a failed read; retry succeeds", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.respond({ success: false, error: "HTTP 429 too many requests", category: ToolExecutionErrorCategory.MCP });
      h.respond({ success: true, redacted: { ok: 1 }, tool: "get_accounts" });
      h.answer("r"); // retry
      const result = await h.run([readEntry()], { auto: true });
      assert.equal(h.calls.length, 2);
      assert.ok(h.sleeps.some((ms) => ms >= 1000), `backoff sleeps: ${h.sleeps}`);
      assert.equal(h.prompts.length, 1);
      assert.match(h.prompts[0], /failed|429/i);
      const cap = readCapture("ro-1");
      assert.equal(cap.outcome, "success");
      assert.equal(result.aborted, false);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("skip records an error capture and continues to the next probe", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.respond({ success: false, error: "boom", category: ToolExecutionErrorCategory.MCP });
      h.respond({ success: true, redacted: { ok: 1 }, tool: "get_accounts" });
      h.answer("s");
      await h.run([readEntry({ id: "f1" }), readEntry({ id: "f2" })], { auto: true });
      assert.equal(h.calls.length, 2);
      const cap = readCapture("f1");
      assert.equal(cap.outcome, "error");
      assert.equal(cap.success, false);
      assert.equal(cap.category, "MCP");
      assert.equal(cap.error, "boom");
      assert.equal(readCapture("f2").outcome, "success");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("abort on a read failure stops the run entirely", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.respond({ success: false, error: "boom", category: ToolExecutionErrorCategory.MCP });
      h.answer("a");
      const result = await h.run([readEntry(), readEntry({ id: "never" })], { auto: true });
      assert.equal(result.aborted, true);
      assert.equal(h.calls.length, 1);
      assert.equal(existsSync(join(REPO_TMP, "never.json")), false);
      assert.ok(h.logs.some((l) => /--from/.test(l)), "resume hint logged");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("mutation gate: 'y' executes with resolved args + extra redact fields", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      await h.run([mutationEntry()], { auto: true });
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0].tool, "place_equity_order");
      assert.equal(h.calls[0].args.account_number, "12345678");
      assert.deepEqual(h.calls[0].extra, ["account_number"]);
      assert.match(h.prompts[0], /mutation|place_equity_order/i);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("mutation gate: 'n' records a declined capture without calling", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("n");
      await h.run([mutationEntry()], { auto: true });
      assert.equal(h.calls.length, 0);
      const cap = readCapture("mut-1");
      assert.equal(cap.outcome, "skipped");
      assert.equal(cap.reason, "declined");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("mutation gate: 'abort' stops the run and prints the recovery checklist", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("abort");
      const result = await h.run([mutationEntry(), readEntry({ id: "after" })], { auto: true });
      assert.equal(result.aborted, true);
      assert.equal(h.calls.length, 0);
      const cap = readCapture("mut-1");
      assert.equal(cap.outcome, "skipped");
      assert.equal(cap.reason, "aborted");
      assert.equal(existsSync(join(REPO_TMP, "after.json")), false);
      const out = h.logs.join("\n");
      assert.match(out, /recovery checklist/i);
      assert.match(out, /get_equity_orders|open orders/i);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("checkpoint prompt fires between groups (not after the last)", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer(""); // continue at checkpoint
      const entries = [
        readEntry({ id: "g1a", group: "one" }),
        readEntry({ id: "g2a", group: "two" }),
        readEntry({ id: "g3a", group: "three" }),
      ];
      await h.run(entries);
      // Two boundaries -> two checkpoint prompts.
      assert.equal(h.prompts.filter((p) => /checkpoint|continue/i.test(p)).length, 2);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("--auto skips checkpoint prompts but still prints group summaries", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      const entries = [readEntry({ id: "g1a", group: "one" }), readEntry({ id: "g2a", group: "two" })];
      await h.run(entries, { auto: true });
      assert.equal(h.prompts.length, 0);
      assert.ok(h.logs.some((l) => /group/.test(l) && /one/.test(l)));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("settle poll repeats until no order is in a pending state", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.respond({ success: true, parsed: { id: "ord-1" }, redacted: { id: "ord-1" }, tool: "place_equity_order" });
      h.respond({
        success: true,
        parsed: { results: [{ id: "ord-1", state: "queued" }] },
        redacted: { results: [{ id: "ord-1", state: "queued" }] },
        tool: "get_equity_orders",
      });
      h.respond({
        success: true,
        parsed: { results: [{ id: "ord-1", state: "filled" }] },
        redacted: { results: [{ id: "ord-1", state: "filled" }] },
        tool: "get_equity_orders",
      });
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 50, timeoutMs: 10000 },
      });
      await h.run([entry], { auto: true });
      assert.equal(h.calls.length, 3);
      assert.equal(h.calls[1].tool, "get_equity_orders");
      const cap = readCapture("mut-1");
      const settle = cap.settle as Record<string, unknown>;
      assert.equal(settle.settled, true);
      assert.equal(settle.attempts, 2);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("settle timeout asks the operator; 'c' continues with settled=false", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y"); // mutation confirm
      h.answer("c"); // settle-timeout continue
      h.respond({ success: true, parsed: {}, redacted: {}, tool: "place_equity_order" });
      // Every settle poll keeps reporting a pending order -> hits the deadline.
      h.fallback({
        success: true,
        parsed: { results: [{ id: "ord-9", state: "new" }] },
        redacted: { results: [{ id: "ord-9", state: "new" }] },
        tool: "get_equity_orders",
      });
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 10, timeoutMs: 25 },
        // fast timeouts; sleep is faked so deadline is attempt-driven
      });
      await h.run([entry], { auto: true });
      const cap = readCapture("mut-1");
      const settle = cap.settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
      assert.ok(h.prompts.some((p) => /settle|pending/i.test(p)));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("resolveEnvArgs replaces whole-value placeholders and reports missing vars", () => {
    const resolved = resolveEnvArgs(
      {
        account_number: "$ENV:RH_ACCOUNT_NUMBER",
        nested: { a: "$ENV:OTHER", keep: "x$ENV:NOPE" },
      },
      { RH_ACCOUNT_NUMBER: "123" },
    );
    assert.deepEqual(resolved.missing.sort(), ["OTHER"]);
    const args = resolved.args as Record<string, unknown>;
    assert.equal(args.account_number, "123");
    assert.equal(
      (args.nested as Record<string, unknown>).a,
      "$ENV:OTHER",
    );
    // Partial placeholders are left untouched (validator rejects them earlier).
    assert.equal(
      (args.nested as Record<string, unknown>).keep,
      "x$ENV:NOPE",
    );
  });

  it("isRateLimitError detects 429 / rate-limit / retry-after text", () => {
    assert.equal(isRateLimitError("HTTP 429"), true);
    assert.equal(isRateLimitError("Rate limit exceeded"), true);
    assert.equal(isRateLimitError("Retry-After: 5"), true);
    assert.equal(isRateLimitError("boom"), false);
    assert.equal(isRateLimitError(undefined), false);
  });

  it("findPendingOrders collects state/status hits at any depth", () => {
    const pending = new Set(["new", "queued", "confirmed"]);
    assert.equal(findPendingOrders({ results: [{ id: "a", state: "filled" }] }, pending).length, 0);
    assert.equal(
      findPendingOrders({ results: [{ id: "a", state: "queued" }, { status: "new" }] }, pending).length,
      2,
    );
    assert.equal(findPendingOrders("nothing", pending).length, 0);
  });

  it("formatAbortChecklist names the probe and recovery steps", () => {
    const text = formatAbortChecklist(mutationEntry(), "mut-2");
    assert.match(text, /mut-1/);
    assert.match(text, /place_equity_order/);
    assert.match(text, /get_equity_orders|open orders/i);
  });

  it("filterProbeEntries errors on unknown --only id", async () => {
    const r = filterProbeEntries([readEntry()], { only: "nope" });
    assert.equal("error" in r, true);
  });

  it("rejects an unknown --group and disjoint --only+--group", async () => {
    const h = harness();
    await assert.rejects(
      () => h.run([readEntry()], { group: "nope", dryRun: true }),
      /group "nope"/,
    );
    await assert.rejects(
      () =>
        h.run(
          [readEntry({ id: "a", group: "g1" }), readEntry({ id: "b", group: "g2" })],
          { only: "a", group: "g2", dryRun: true },
        ),
      /empty probe set/,
    );
  });

  it("mutation retry RE-GATES — 'r' re-prompts y/n/abort before re-firing", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");  // initial gate
      h.answer("r");  // failure: retry requested
      h.answer("y");  // re-gate confirm
      h.respond({ success: false, error: "MCP callTool timed out", category: ToolExecutionErrorCategory.MCP });
      h.respond({ success: true, redacted: { order_id: "x" }, tool: "place_equity_order" });
      await h.run([mutationEntry()], { auto: true });
      assert.equal(h.calls.length, 2, "retried after re-confirm");
      assert.equal(h.prompts.length, 3, "gate + failure + re-gate");
      assert.match(h.prompts[2], /retry|live order|ref_id/i);
      assert.equal(readCapture("mut-1").outcome, "success");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("mutation retry declined at re-gate keeps the error outcome", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("r");
      h.answer("n"); // operator declines at re-gate
      h.respond({ success: false, error: "timeout", category: ToolExecutionErrorCategory.MCP });
      const result = await h.run([mutationEntry()], { auto: true });
      assert.equal(h.calls.length, 1, "no second call without re-confirm");
      assert.equal(result.aborted, false);
      assert.equal(readCapture("mut-1").outcome, "error");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("scrubs resolved env values out of persisted error strings", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness({ RH_ACCOUNT_NUMBER: "87654321" });
      h.answer("s");
      h.respond({
        success: false,
        error: "account 87654321 is not agentic_allowed",
        category: ToolExecutionErrorCategory.MCP,
      });
      await h.run(
        [readEntry({ id: "ro-scrub", args: { account_number: "$ENV:RH_ACCOUNT_NUMBER" } })],
        { auto: true },
      );
      const cap = readCapture("ro-scrub");
      assert.ok(!(cap.error as string).includes("87654321"), "raw account leaked");
      assert.ok((cap.error as string).includes("•"), "masked form");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("settle timeout records the pending orders in the capture", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("c");
      h.fallback({
        success: true,
        parsed: { results: [{ id: "ord-7", state: "partially_filled" }] },
        redacted: { results: [{ id: "ord-7", state: "partially_filled" }] },
        tool: "get_equity_orders",
      });
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 5, timeoutMs: 15 },
      });
      await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
      // partially_filled must be in the default pending set.
      assert.deepEqual(settle.pending, [{ id: "ord-7", state: "partially_filled" }]);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("settle timeout fails closed — non-'c' answers abort", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("n"); // NOT 'c' -> abort (covers non-interactive default too)
      h.fallback({
        success: true,
        parsed: { results: [{ state: "new" }] },
        redacted: { results: [{ state: "new" }] },
        tool: "get_equity_orders",
      });
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 5, timeoutMs: 15 },
      });
      const result = await h.run([entry, readEntry({ id: "after" })], { auto: true });
      assert.equal(result.aborted, true);
      assert.equal(existsSync(join(REPO_TMP, "after.json")), false);
      assert.ok(h.logs.join("\n").includes("recovery checklist"));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("treats an empty-string env value as missing", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness({ RH_ACCOUNT_NUMBER: "" });
      const entry = readEntry({
        id: "ro-empty",
        args: { account_number: "$ENV:RH_ACCOUNT_NUMBER" },
      });
      await h.run([entry], { auto: true });
      assert.equal(h.calls.length, 0);
      assert.equal(readCapture("ro-empty").reason, "missing-env");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("maskResolvedArgs masks env-derived leaves and keeps literals", () => {
    const masked = maskResolvedArgs(
      { account_number: "$ENV:A", symbol: "OOMA" },
      { account_number: "12345678", symbol: "OOMA" },
    );
    assert.equal(masked.symbol, "OOMA");
    assert.equal(masked.account_number, "••••5678"); // maskAccountNumber keeps last 4
    assert.ok(!JSON.stringify(masked).includes("12345678"));
  });

  it("scrubSecrets masks every resolved secret occurrence", () => {
    const out = scrubSecrets("acct 12345678 rejected for 12345678", ["12345678"]);
    assert.ok(!out.includes("12345678"));
  });

  it("last-probe abort prints no --from hint (nothing left to resume)", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("n"); // settle timeout -> not 'c' -> abort
      h.fallback({
        success: true,
        parsed: { results: [{ id: "ord-x", state: "new" }] },
        redacted: { results: [{ id: "ord-x", state: "new" }] },
        tool: "get_equity_orders",
      });
      // mut-1 is the LAST planned probe — resuming at it would re-fire.
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 5, timeoutMs: 15 },
      });
      const result = await h.run([entry], { auto: true });
      assert.equal(result.aborted, true);
      const out = h.logs.join("\n");
      assert.ok(out.includes("recovery checklist"));
      assert.ok(!out.includes(`--from ${entry.id}`), "self-referencing resume hint");
      assert.ok(out.includes("nothing left to resume"));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("missing settle-only env skips pre-gate instead of false-settling", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness({ RH_ACCOUNT_NUMBER: "12345678" }); // probe env fine
      h.answer("y");
      const entry = mutationEntry({
        settle: {
          tool: "get_equity_orders",
          args: { settle_only: "$ENV:SETTLE_ONLY_MISSING" },
        },
      });
      const result = await h.run([entry], { auto: true });
      assert.equal(result.aborted, false);
      const cap = readCapture("mut-1");
      assert.equal(cap.outcome, "skipped");
      assert.equal(cap.reason, "missing-env");
      assert.ok((cap.missingEnv as string[]).includes("SETTLE_ONLY_MISSING"));
      assert.ok(
        h.logs.join("\n").includes("missing env SETTLE_ONLY_MISSING"),
      );
      // Pre-flight check — the mutation never fired and no poll ran.
      assert.equal(h.calls.length, 0);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("missing settle env discovered post-fire still aborts (defense in depth)", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      // Env var present at pre-flight but absent when settlePoll resolves —
      // simulate by unsetting via a proxy env that flips between calls.
      let settleVarPresent = true;
      const env = new Proxy(
        { RH_ACCOUNT_NUMBER: "12345678" } as Record<string, string>,
        {
          get: (t, k) =>
            k === "SETTLE_LATE" ? (settleVarPresent ? "acct" : undefined) : t[k as string],
        },
      );
      const h = harness({ RH_ACCOUNT_NUMBER: "12345678" });
      h.answer("y");
      const entry = mutationEntry({
        settle: {
          tool: "get_equity_orders",
          args: { settle_only: "$ENV:SETTLE_LATE" },
        },
      });
      // The settle call-site merge resolves entry.settle.args again inside
      // settlePoll — flip availability after the pre-flight pass by racing.
      const pending = h.run([entry], { auto: true, env });
      settleVarPresent = false;
      const result = await pending;
      assert.equal(result.aborted, true);
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
      assert.ok(h.logs.join("\n").includes("recovery checklist"));
      assert.equal(h.calls.length, 1); // mutation fired, no polls
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("scrubSecrets masks overlapping secrets longest-first (no partial leak)", () => {
    // "5678" is a substring of "12345678" — masking the shorter first would
    // fragment the longer and leave "1234" exposed.
    const out = scrubSecrets("acct 12345678 rejected", ["5678", "12345678"]);
    assert.ok(!out.includes("12345678"));
    assert.ok(!out.includes("1234"));
    assert.ok(!out.includes("5678"));
  });

  it("settle pending order ids are scrubbed of resolved env values", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness({ RH_ACCOUNT_NUMBER: "12345678" });
      h.answer("y");
      h.answer("c"); // continue past settle timeout
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 0, timeoutMs: 1 },
      });
      // Settle poll returns a pending order whose id equals the resolved
      // env secret — it must not persist raw in the capture or the log.
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      h.respond({
        success: true,
        parsed: { results: [{ id: "12345678", state: "new" }] },
        redacted: { results: [{ id: "12345678", state: "new" }] },
      });
      h.delay(2); // real ms so timeoutMs:1 crosses the deadline after poll 1
      await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as {
        pending: Array<{ id: string; state: string }>;
      };
      assert.ok(!settle.pending[0].id.includes("12345678"));
      assert.ok(!h.logs.join("\n").includes("12345678:"));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("tool-level isError payload does not false-settle", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("c"); // continue past settle timeout
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 0, timeoutMs: 1 },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      // Transport success carrying a tool-level error — no state fields.
      h.respond({
        success: true,
        parsed: { isError: true, error: "Insufficient buying power" },
        redacted: { isError: true, error: "Insufficient buying power" },
      });
      h.delay(2);
      await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
      assert.ok((settle.lastError as string).includes("Insufficient buying power"));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("redacted-only response with masked states is inconclusive, not settled", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("c");
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 0, timeoutMs: 1 },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      // No `parsed`; redacted states masked → cannot confirm → keep polling.
      h.respond({
        success: true,
        redacted: { results: [{ id: "ord-1", state: "••••" }] },
      });
      h.delay(2);
      await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("a mutation settle tool is refused post-fire (defense in depth)", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      const entry = mutationEntry({
        settle: { tool: "place_equity_order" }, // loader would reject this
      });
      const result = await h.run([entry], { auto: true });
      assert.equal(result.aborted, true);
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
      assert.ok((settle.lastError as string).includes("mutation"));
      // Mutation fired once; the settle mutation never polled.
      assert.equal(h.calls.length, 1);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("cross-set secrets cannot fragment each other (shorter settle secret)", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      // Probe secret "12345678"; settle-only secret "5678" — a two-pass scrub
      // that masked "5678" first would leave "1234" exposed.
      const h = harness({ RH_ACCOUNT_NUMBER: "12345678", SETTLE_S: "5678" });
      h.answer("y");
      h.answer("c");
      const entry = mutationEntry({
        settle: {
          tool: "get_equity_orders",
          intervalMs: 0,
          timeoutMs: 1,
          args: { note: "$ENV:SETTLE_S" },
        },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      h.respond({ success: false, error: "acct 12345678 denied 5678", category: ToolExecutionErrorCategory.MCP });
      h.delay(2);
      await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.ok(!(settle.lastError as string).includes("1234"));
      assert.ok(!(settle.lastError as string).includes("12345678"));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("envelope-level isError (unparseable text, no parsed) does not settle", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("c");
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 0, timeoutMs: 1 },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      // Real executor shape for a non-JSON tool error: parsed undefined,
      // redacted = raw MCP envelope.
      h.respond({
        success: true,
        redacted: { isError: true, content: [{ type: "text", text: "denied" }] },
      });
      h.delay(2);
      await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("cap.response is deep-scrubbed — env values in error text never persist", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      // Field-name redaction doesn't cover free-text values — the runner
      // must scrub resolved env values out of the persisted response.
      const entry = readEntry({ args: { account_number: "$ENV:RH_ACCOUNT_NUMBER" } });
      h.respond({
        success: true,
        parsed: { isError: true, error: "account 12345678 denied" },
        redacted: { isError: true, error: "account 12345678 denied" },
      });
      await h.run([entry], { auto: true });
      const response = readCapture("ro-1").response as Record<string, unknown>;
      assert.ok(!(response.error as string).includes("12345678"));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("parsed-body isError (no envelope flag) records error, not success", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("s");
      // Injectable caller may not surface toolError — the parsed-body
      // isError channel must still catch it.
      h.respond({
        success: true,
        parsed: { isError: true, error: "account not agentic_allowed" },
        redacted: { isError: true, error: "account not agentic_allowed" },
        tool: "get_accounts",
      });
      const result = await h.run([readEntry()], { auto: true });
      assert.equal(result.aborted, false);
      const cap = readCapture("ro-1");
      assert.equal(cap.outcome, "error");
      assert.equal(cap.success, false);
      assert.equal(cap.category, "MCP");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("executor-surfaced toolError records error, not success", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("s"); // skip after recording the failure
      // Envelope isError with a JSON body: parsed holds the body, so only
      // the executor-surfaced `toolError` can signal the failure.
      h.respond({
        success: true,
        parsed: { detail: "account not found" },
        redacted: { detail: "account not found" },
        tool: "get_accounts",
        toolError: "account not found",
      });
      const result = await h.run([readEntry()], { auto: true });
      assert.equal(result.aborted, false);
      const cap = readCapture("ro-1");
      assert.equal(cap.outcome, "error");
      assert.equal(cap.success, false);
      assert.equal(cap.error, "account not found");
      assert.equal(cap.category, "MCP");
      // Payload still captured for the discovery doc.
      assert.ok(cap.response !== undefined);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("settle poll honors executor-surfaced toolError", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("c");
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 0, timeoutMs: 1 },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      h.respond({
        success: true,
        parsed: { detail: "x" }, // JSON body — envelope flag invisible to parsed
        redacted: { detail: "x" },
        toolError: "settle query failed",
      });
      h.delay(2);
      await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
      assert.ok((settle.lastError as string).includes("settle query failed"));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("a success with undefined redacted does not crash the run", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.respond({ success: true, redacted: undefined, tool: "t" });
      const result = await h.run([readEntry()], { auto: true });
      assert.equal(result.aborted, false);
      const cap = readCapture("ro-1");
      assert.equal(cap.outcome, "success");
      assert.equal(cap.response, null);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("a mutation tool declared gate:'read' still hits the gate", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      // Non-loader caller mislabels a mutation as a read — the two-authority
      // check must catch it. 'n' (fail-closed default) declines.
      const entry = mutationEntry({ gate: "read" });
      const result = await h.run([entry], { auto: true });
      assert.equal(result.aborted, false);
      assert.equal(h.calls.length, 0, "mutation never fired ungated");
      assert.ok(h.prompts.join("\n").includes("execute mut-1"));
      const cap = readCapture("mut-1");
      assert.equal(cap.outcome, "skipped");
      assert.equal(cap.reason, "declined");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("shapeless settle body (no list, no state) is inconclusive — never settles", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("a");
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 0, timeoutMs: 1 },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      // Usable parsed body, but no order list and no KNOWN order state —
      // `status: 'ok'` is not order evidence. The poll cannot confirm
      // settlement and must NOT report settled.
      h.respond({
        success: true,
        parsed: { status: "ok", detail: "Not found" },
        redacted: { status: "ok", detail: "Not found" },
      });
      h.delay(2);
      const result = await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
      assert.equal(result.aborted, true);
      assert.ok(
        (settle.lastError as string).includes("cannot confirm"),
      );
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("a single terminal-order object settles (positive state evidence)", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 0, timeoutMs: 5000 },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      h.respond({
        success: true,
        parsed: { id: "ord-1", state: "filled" },
        redacted: { id: "ord-1", state: "filled" },
      });
      const result = await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, true);
      assert.equal(result.aborted, false);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("a FAILED mutation still settle-polls — the call may have reached the server", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y"); // gate
      h.answer("s"); // failure prompt: skip retry, continue
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 0, timeoutMs: 5000 },
      });
      // Transport timeout — the server may have accepted the order.
      h.respond({ success: false, error: "MCP callTool timed out", category: ToolExecutionErrorCategory.MCP });
      h.respond({
        success: true,
        parsed: { results: [] },
        redacted: { results: [] },
      });
      const result = await h.run([entry], { auto: true });
      assert.equal(result.aborted, false);
      assert.equal(readCapture("mut-1").outcome, "error");
      // The settle poll ran DESPITE the recorded error — discharges the
      // "order may already be live" hazard instead of proceeding blind.
      assert.ok(h.calls.some((c) => c.tool === "get_equity_orders"));
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, true);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("coincidental terminal-vocab wrapper is NOT order evidence", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("a");
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 0, timeoutMs: 1 },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      // A wrapper carrying a known terminal word but no order id.
      h.respond({
        success: true,
        parsed: { meta: { status: "cancelled" } },
        redacted: { meta: { status: "cancelled" } },
      });
      h.delay(2);
      const result = await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
      assert.equal(result.aborted, true);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("single-order body with partially_filled_rest_cancelled settles", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      const entry = mutationEntry({
        settle: { tool: "get_equity_orders", intervalMs: 0, timeoutMs: 5000 },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      h.respond({
        success: true,
        parsed: { id: "ord-1", state: "partially_filled_rest_cancelled" },
        redacted: { id: "ord-1", state: "partially_filled_rest_cancelled" },
      });
      const result = await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, true);
      assert.equal(result.aborted, false);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("empty settle.pendingStates falls back to defaults", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("a"); // abort at settle timeout
      const entry = mutationEntry({
        settle: {
          tool: "get_equity_orders",
          pendingStates: [], // would settle instantly if trusted
          intervalMs: 0,
          timeoutMs: 1,
        },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      h.respond({
        success: true,
        parsed: { results: [{ id: "ord-1", state: "new" }] },
        redacted: { results: [{ id: "ord-1", state: "new" }] },
      });
      h.delay(2);
      const result = await h.run([entry], { auto: true });
      // The pending 'new' order was detected via the default state set —
      // record is NOT settled.
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
      assert.equal(result.aborted, true);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("a later transport failure clears an earlier attempt's response", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("r");
      h.answer("s");
      // Attempt 1: toolError success → payload captured. Attempt 2: transport
      // failure → response must not mislabel the earlier payload as final.
      h.respond({
        success: true,
        parsed: { detail: "first" },
        redacted: { detail: "first" },
        tool: "get_accounts",
        toolError: "first attempt error",
      });
      h.respond({ success: false, error: "boom", category: ToolExecutionErrorCategory.MCP });
      await h.run([readEntry()], { auto: true });
      const cap = readCapture("ro-1");
      assert.equal(cap.outcome, "error");
      assert.equal(cap.response, undefined);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("non-array settle.pendingStates falls back to defaults", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("a");
      const entry = mutationEntry({
        settle: {
          tool: "get_equity_orders",
          // A bare string has .length — would produce Set('n','e','w') and
          // never match a real state → instant false-settle if trusted.
          pendingStates: "new" as unknown as string[],
          intervalMs: 0,
          timeoutMs: 1,
        },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      h.respond({
        success: true,
        parsed: { results: [{ id: "ord-1", state: "new" }] },
        redacted: { results: [{ id: "ord-1", state: "new" }] },
      });
      h.delay(2);
      const result = await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
      assert.equal(result.aborted, true);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("narrowed pendingStates unions with defaults — cannot false-settle", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      h.answer("a");
      const entry = mutationEntry({
        settle: {
          tool: "get_equity_orders",
          // Terminal state only — 'new' must STILL count as pending (union).
          pendingStates: ["filled"],
          intervalMs: 0,
          timeoutMs: 1,
        },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      h.respond({
        success: true,
        parsed: { results: [{ id: "ord-1", state: "new" }] },
        redacted: { results: [{ id: "ord-1", state: "new" }] },
      });
      h.delay(2);
      const result = await h.run([entry], { auto: true });
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, false);
      assert.equal(result.aborted, true);
      // Effective set recorded is the union, not the narrowed list.
      assert.ok((settle.pendingStates as string[]).includes("new"));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("settle poll pins pre-fire env values — post-fire drift can't rescope", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const env: Record<string, string> = { RH_ACCOUNT_NUMBER: "acct-A" };
      const h = harness(env);
      h.answer("y");
      const entry = mutationEntry({
        settle: {
          tool: "get_equity_orders",
          args: { account_number: "$ENV:RH_ACCOUNT_NUMBER" },
        },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      h.respond({
        success: true,
        parsed: { results: [] },
        redacted: { results: [] },
      });
      const result = await h.run([entry], {
        auto: true,
        caller: async (tool: string, args: Record<string, unknown>, extra?: string[]) => {
          h.calls.push({ tool, args, extra });
          if (tool === "place_equity_order") {
            // Drift AFTER the confirmed mutation — the settle poll must still
            // query the account the order was placed on.
            env.RH_ACCOUNT_NUMBER = "acct-B";
            return { success: true, redacted: { ok: true }, parsed: { ok: true } };
          }
          return {
            success: true,
            parsed: { results: [] },
            redacted: { results: [] },
          };
        },
      });
      assert.equal(result.aborted, false);
      const settleCall = h.calls.find((c) => c.tool === "get_equity_orders");
      assert.equal(settleCall?.args.account_number, "acct-A");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("cap.response scrubs secrets containing JSON-escaped characters", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness({ RH_ACCOUNT_NUMBER: 'a"b' });
      const entry = readEntry({ args: { account_number: "$ENV:RH_ACCOUNT_NUMBER" } });
      h.respond({
        success: true,
        parsed: { detail: 'acct a"b denied' },
        redacted: { detail: 'acct a"b denied' },
      });
      await h.run([entry], { auto: true });
      const cap = readCapture("ro-1");
      const serialized = JSON.stringify(cap.response);
      assert.ok(!serialized.includes('a"b'), "raw secret persisted");
      assert.ok(!serialized.includes('a\\"b'), "escaped secret persisted");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("cap.response scrubs env values used as object KEYS", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness({ RH_ACCOUNT_NUMBER: "acct-9" });
      const entry = readEntry({ args: { account_number: "$ENV:RH_ACCOUNT_NUMBER" } });
      h.respond({
        success: true,
        parsed: { "acct-9": { buying_power: "100" } },
        redacted: { "acct-9": { buying_power: "100" } },
      });
      await h.run([entry], { auto: true });
      const cap = readCapture("ro-1");
      assert.ok(!JSON.stringify(cap.response).includes("acct-9"));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("shared (DAG) arg subtrees resolve — no raw placeholder leaks through", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness({ RH_ACCOUNT_NUMBER: "acct-1" });
      const shared = { account_number: "$ENV:RH_ACCOUNT_NUMBER" };
      const entry = readEntry({ args: { primary: shared, secondary: shared } });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      await h.run([entry], { auto: true });
      const sent = h.calls[0].args as Record<string, Record<string, unknown>>;
      assert.equal(sent.secondary.account_number, "acct-1");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("cyclic args abort gracefully — no uncaught stack overflow", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      const cyclic: Record<string, unknown> = { a: 1 };
      cyclic.self = cyclic;
      const entry = readEntry({ args: cyclic });
      const result = await h.run([entry], { auto: true });
      assert.equal(result.aborted, true);
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("invalid settle timing values fall back to defaults (no hot loop)", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      const entry = mutationEntry({
        settle: {
          tool: "get_equity_orders",
          // NaN interval would hot-loop; NaN deadline never triggers the
          // timeout prompt. Both must normalize to the defaults.
          intervalMs: Number.NaN,
          timeoutMs: Number.NaN,
        },
      });
      h.respond({ success: true, redacted: { ok: true }, parsed: { ok: true } });
      h.respond({
        success: true,
        parsed: { results: [{ id: "ord-1", state: "new" }] },
        redacted: { results: [{ id: "ord-1", state: "new" }] },
      });
      // An empty list container is positive order evidence → settles.
      h.respond({
        success: true,
        parsed: { results: [] },
        redacted: { results: [] },
      });
      const result = await h.run([entry], { auto: true });
      assert.equal(result.aborted, false);
      const settle = readCapture("mut-1").settle as Record<string, unknown>;
      assert.equal(settle.settled, true);
      assert.equal(settle.attempts, 2);
      // The sleep between polls must be the 2000ms default — not NaN/0.
      assert.ok(h.sleeps.includes(2000));
      assert.ok(h.sleeps.every((s) => Number.isFinite(s) && s > 0));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("thrown caller errors are scrubbed of resolved env values", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness({ RH_ACCOUNT_NUMBER: "87654321" });
      const result = await h.run(
        [readEntry({ id: "ro-throw", args: { account_number: "$ENV:RH_ACCOUNT_NUMBER" } })],
        {
          auto: true,
          caller: async () => {
            throw new Error("connect failed for account 87654321");
          },
        },
      );
      assert.equal(result.aborted, true);
      const cap = readCapture("ro-throw");
      assert.ok(!(cap.error as string).includes("87654321"), "raw secret leaked");
      assert.ok((cap.error as string).includes("••••"));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("capture-write failure still emits the mutation checklist", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      // Point captureDir at a path under a FILE -> mkdir/write always fail.
      const blocker = join(REPO_TMP, "blocker-file");
      writeFileSync(blocker, "x");
      const badDir = join(blocker, "captures");
      const h = harness();
      h.answer("y");
      const result = await h.run([mutationEntry()], {
        auto: true,
        captureDir: badDir,
      });
      assert.equal(result.aborted, true);
      assert.ok(h.logs.join("\n").includes("recovery checklist"), "checklist on write failure");
      assert.equal(result.captures.length, 1, "in-memory ledger keeps the capture");
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });

  it("a throwing caller leaves an error capture + aborts (mutation checklist)", async () => {
    mkdirSync(REPO_TMP, { recursive: true });
    try {
      const h = harness();
      h.answer("y");
      const result = await h.run([mutationEntry()], {
        auto: true,
        caller: async () => {
          throw new Error("executor blew up");
        },
      });
      assert.equal(result.aborted, true);
      const cap = readCapture("mut-1");
      assert.equal(cap.outcome, "error");
      assert.equal(cap.error, "executor blew up");
      assert.ok(h.logs.join("\n").includes("recovery checklist"));
    } finally {
      rmSync(REPO_TMP, { recursive: true, force: true });
    }
  });
});
