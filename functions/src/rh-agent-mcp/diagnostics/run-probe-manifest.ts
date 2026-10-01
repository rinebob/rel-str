/**
 * Probe manifest runner (task #683): sequential execution of the RH MCP
 * discovery manifest with per-probe captures.
 *
 * - Validates the manifest against the LIVE tools/list (the bundled catalog
 *   can be stale — e.g. missing place_option_order.direction).
 * - 'read' probes run unattended with ~300ms spacing; failures and 429s
 *   back off then ask retry/skip/abort; group boundaries checkpoint.
 * - 'mutation' probes hard-stop for a per-call y/n/abort — there is no
 *   bypass flag by design. 'abort' prints the order-recovery checklist.
 * - Captures write to captures/{id}.json: manifest args (env placeholders
 *   intact) + redacted response + latency + success/category.
 *
 * Usage (from functions/):
 *   npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts
 *     [--manifest <path>] [--captures <dir>]
 *     [--only <id>] [--group <name>] [--from <id>]
 *     [--dry-run] [--auto] [--pace-ms <n>]
 *
 * Requires a stored local RH credential unless --dry-run (which validates
 * against the bundled catalog and never connects). Non-interactive stdin
 * fails closed: mutation prompts answer 'n' (skip).
 */
import { createInterface } from 'node:readline/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLiveToolList } from './catalog-drift';
import {
  formatProbePlan,
  loadProbeManifest,
  toToolDefinitions,
} from './probe-manifest';
import { runProbePlan } from './probe-runner';
import {
  categorizeExecutionError,
  executeObservationTool,
  MCP_CALL_TIMEOUT_MS,
  parseToolResult,
  toolEnvelopeError,
  withTimeout,
} from '../tools/robinhood-tool-executor';
import {
  connectLocalRobinhoodMcpSession,
  type ConnectedRobinhoodMcpSession,
} from '../auth/robinhood-mcp-connection';
import {
  isMutationTool,
  loadToolCatalog,
  stripServerPrefix,
} from '../tools/robinhood-tools';
import { validateToolArgs } from '../tools/schema-validation';
import { redactResponse, type RedactionOptions } from '../tools/robinhood-response-redactor';
import {
  ToolExecutionErrorCategory,
  type RobinhoodToolDefinition,
  type ToolExecutionResult,
} from '@robinhood-mcp/contracts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DEFAULT_MANIFEST = join(REPO_ROOT, 'docs', 'topics', '657-rh-mcp', 'probe-manifest.json');
const DEFAULT_CAPTURES = join(REPO_ROOT, 'docs', 'topics', '657-rh-mcp', 'captures');

interface CliArgs {
  manifest: string;
  captures: string;
  only?: string;
  group?: string;
  from?: string;
  dryRun: boolean;
  auto: boolean;
  paceMs?: number;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    manifest: DEFAULT_MANIFEST,
    captures: DEFAULT_CAPTURES,
    dryRun: false,
    auto: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} requires a value`);
      return v;
    };
    switch (flag) {
      case '--manifest': args.manifest = next(); break;
      case '--captures': args.captures = next(); break;
      case '--only': args.only = next(); break;
      case '--group': args.group = next(); break;
      case '--from': args.from = next(); break;
      case '--pace-ms': args.paceMs = Number(next()); break;
      case '--dry-run': args.dryRun = true; break;
      case '--auto': args.auto = true; break;
      case '--help': case '-h': args.help = true; break;
      default: throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (args.paceMs !== undefined && !(Number.isFinite(args.paceMs) && args.paceMs > 0)) {
    throw new Error('--pace-ms must be a positive finite number');
  }
  return args;
}

const USAGE = `run-probe-manifest — execute the RH MCP discovery manifest

  --manifest <path>   manifest JSON (default: docs/topics/657-rh-mcp/probe-manifest.json)
  --captures <dir>    capture output dir (default: docs/topics/657-rh-mcp/captures)
  --only <id>         run exactly one probe
  --group <name>      run one manifest group
  --from <id>         resume: run from this probe onward
  --pace-ms <n>       spacing between unattended reads (default 300)
  --dry-run           validate + print plan; no calls, no captures
  --auto              skip group-checkpoint prompts (summaries still print)
  --help              this text

Mutation probes always prompt y/n/abort per call — there is intentionally
no flag to bypass the gate.`;

/**
 * Mutation probe executor — confirmed (post-prompt) mutation calls go through
 * this path and validate args against the LIVE tools/list definition the
 * manifest was checked against (the bundled catalog can drift — ajv runs
 * removeAdditional and would silently strip a live-only param like
 * `direction` before placing a real order). Same envelope handling +
 * redaction as executeObservationTool.
 */
async function executeProbeMutation(
  toolName: string,
  args: unknown,
  redactionOptions: RedactionOptions,
  definition: RobinhoodToolDefinition | undefined,
): Promise<ToolExecutionResult> {
  // Fail closed: never call a tool that isn't classified as a mutation.
  if (!definition || !(definition.mutation || isMutationTool(toolName))) {
    return {
      success: false,
      error: `Tool "${toolName}" is not classified as a mutation — refusing to execute.`,
      category: ToolExecutionErrorCategory.VALIDATION,
    };
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return {
      success: false,
      error: 'Tool arguments must be a JSON object.',
      category: ToolExecutionErrorCategory.VALIDATION,
    };
  }
  const validation = validateToolArgs(
    definition.inputSchema,
    args as Record<string, unknown>,
  );
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      category: ToolExecutionErrorCategory.VALIDATION,
    };
  }
  let connection: ConnectedRobinhoodMcpSession | undefined;
  try {
    connection = await connectLocalRobinhoodMcpSession();
    const mcpResult = await withTimeout(
      connection.session.callTool(stripServerPrefix(toolName), validation.args),
      MCP_CALL_TIMEOUT_MS,
      `MCP callTool timed out after ${MCP_CALL_TIMEOUT_MS / 1000}s for tool "${toolName}"`,
    );
    const parsed = parseToolResult(mcpResult);
    const toolError = toolEnvelopeError(mcpResult);
    return {
      success: true,
      parsed,
      redacted: redactResponse(parsed ?? mcpResult, redactionOptions),
      tool: toolName,
      ...(toolError !== undefined ? { toolError } : {}),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      category: categorizeExecutionError(error),
    };
  } finally {
    await connection?.close().catch(() => undefined);
  }
}

function makePrompt(): (message: string) => Promise<string> {
  // The readline interface is created lazily so a --dry-run / non-interactive
  // run never holds stdin open.
  let rl: ReturnType<typeof createInterface> | undefined;
  const interactive = process.stdin.isTTY === true;
  return async (message: string) => {
    if (!interactive) {
      // Fail closed when nobody can answer: mutation gates read 'n' as skip,
      // failure prompts read it as "record error + continue", and the settle
      // timeout aborts unless the answer is an explicit 'c'.
      console.log(`[non-interactive] ${message} -> 'n'`);
      return 'n';
    }
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    return rl.question(`${message}\n> `);
  };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(USAGE);
    return;
  }

  // Authoritative tool set: live tools/list for real runs; the bundled
  // catalog for --dry-run (no credentials needed to plan).
  const knownTools = cli.dryRun
    ? toToolDefinitions((await loadToolCatalog()).tools)
    : toToolDefinitions(await fetchLiveToolList());

  const manifest = await loadProbeManifest(cli.manifest, { knownTools });
  for (const w of manifest.warnings) console.warn(`warn: ${w.message}`);
  if (!manifest.ok) {
    for (const e of manifest.errors) console.error(`error: ${e.message}`);
    process.exit(1);
  }

  if (cli.dryRun) {
    const result = await runProbePlan({
      entries: manifest.entries,
      caller: () => Promise.reject(new Error('dry-run must not call tools')),
      prompt: () => Promise.reject(new Error('dry-run must not prompt')),
      captureDir: cli.captures,
      only: cli.only,
      group: cli.group,
      from: cli.from,
      dryRun: true,
    });
    console.log(formatProbePlan(result.planned));
    console.log(`\n${result.planned.length} probe(s) planned — dry run, nothing executed.`);
    return;
  }

  const defs = new Map(knownTools.map((d) => [d.name, d]));
  const prompt = makePrompt();

  const caller = async (
    tool: string,
    args: Record<string, unknown>,
    extraRedactFields?: string[],
  ): Promise<ToolExecutionResult> => {
    // NOTE: `isObservationTool` checks ALL_ENABLED_TOOLS — every mutation is
    // enabled too, so it is NOT a read-only classifier. Dispatch on the
    // mutation classification first; everything else goes through the
    // allowlisted observation path (which fails closed on unknown tools).
    const def = defs.get(stripServerPrefix(tool));
    if (isMutationTool(tool) || def?.mutation === true) {
      return executeProbeMutation(
        tool,
        args,
        { extraFields: extraRedactFields },
        def,
      );
    }
    // Pass the live definition — the bundled catalog can drift, and ajv
    // removeAdditional would silently strip a live-only param before the
    // call (same hazard class the mutation path guards with live defs).
    return executeObservationTool(
      tool,
      args,
      { extraFields: extraRedactFields },
      { definition: def },
    );
  };

  const result = await runProbePlan({
    entries: manifest.entries,
    caller,
    prompt,
    captureDir: cli.captures,
    only: cli.only,
    group: cli.group,
    from: cli.from,
    auto: cli.auto,
    paceMs: cli.paceMs,
    // Loader parity for the settle-tool guard: both authorities (static set +
    // live definition flag), never under-gate.
    isMutationTool: (tool) =>
      isMutationTool(tool) || defs.get(stripServerPrefix(tool))?.mutation === true,
  });

  const ok = result.captures.filter((c) => c.outcome === 'success').length;
  const skipped = result.captures.filter((c) => c.outcome === 'skipped').length;
  const failed = result.captures.filter((c) => c.outcome === 'error').length;
  console.log(
    `\nrun ${result.aborted ? 'ABORTED' : 'complete'}: ` +
      `${ok} ok / ${skipped} skipped / ${failed} failed — captures in ${cli.captures}`,
  );
  process.exit(result.aborted ? 2 : failed > 0 ? 3 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
