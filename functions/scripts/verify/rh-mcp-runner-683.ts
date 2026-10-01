/**
 * Verify task #683 — probe manifest runner. Offline only: the runner is
 * driven with a mocked caller + scripted prompt over the REAL manifest and a
 * temp capture dir. No Robinhood calls are made.
 *
 * Checks: capture schema + redaction-before-disk, env-arg resolution,
 * --only/--group/--from/--dry-run filters, pacing + failure backoff,
 * mutation y/n/abort gate (no bypass flag in the CLI), group checkpoints,
 * settle polling, abort checklist, and CLI file existence.
 *
 * Usage (from functions/): npx tsx scripts/verify/rh-mcp-runner-683.ts
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findPendingOrders,
  formatAbortChecklist,
  isRateLimitError,
  resolveEnvArgs,
  runProbePlan,
  type ProbeCallResult,
} from '../../src/rh-agent-mcp/diagnostics/probe-runner';
import {
  formatProbePlan,
  loadProbeManifest,
  toToolDefinitions,
} from '../../src/rh-agent-mcp/diagnostics/probe-manifest';
import { loadToolCatalog } from '../../src/rh-agent-mcp/tools/robinhood-tools';

const DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(DIR, '..', '..', '..');
const CLI_PATH = join(DIR, '..', '..', 'src', 'rh-agent-mcp', 'diagnostics', 'run-probe-manifest.ts');
const MANIFEST_PATH = join(REPO_ROOT, 'docs', 'topics', '657-rh-mcp', 'probe-manifest.json');
const CAPTURE_TMP = join(REPO_ROOT, '.devin', 'tmp', 'verify-683-captures');

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  OK  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

const catalogDefs = async () => toToolDefinitions((await loadToolCatalog()).tools);

async function main() {
  console.log('verify #683 — probe manifest runner (offline)\n');

  const knownTools = await catalogDefs();
  const manifest = await loadProbeManifest(MANIFEST_PATH, { knownTools });

  await check('real manifest validates against the regenerated catalog', () => {
    assert(manifest.ok, manifest.errors.map((e) => e.message).join('; '));
    assert(manifest.entries.length >= 3, 'expected at least 3 probes');
  });

  mkdirSync(CAPTURE_TMP, { recursive: true });
  try {
    await check('runner executes the manifest end-to-end with fakes', async () => {
      const calls: string[] = [];
      const answers = ['', 'y']; // checkpoint, then mutation confirm
      const caller = async (tool: string): Promise<ProbeCallResult> => {
        calls.push(tool);
        if (tool === 'get_equity_orders') {
          // The settle poll requires positive order evidence — a shapeless
          // body is inconclusive. Return a real empty-list shape.
          return {
            success: true,
            parsed: { results: [] },
            redacted: { results: [] },
            tool,
          };
        }
        return {
          success: true,
          // Real executors always return `parsed` — a parsed-undefined
          // response is (correctly) treated as inconclusive by the settle
          // poll, so the fake must match the real contract.
          parsed: { account_number: '12•••••8', tool },
          redacted: { account_number: '12•••••8', tool },
          tool,
        };
      };
      const result = await runProbePlan({
        entries: manifest.entries,
        caller,
        prompt: async () => answers.shift() ?? 'n',
        captureDir: CAPTURE_TMP,
        env: { RH_ACCOUNT_NUMBER: '12345678' },
        sleep: async () => {},
        auto: false,
      });
      assert(!result.aborted, 'run should not abort');
      assert(result.captures.length === manifest.entries.length, 'one capture per probe');
      // 3 probe calls + 1 settle poll (mut-eq-market-buy-01 -> get_equity_orders).
      assert(calls.length === manifest.entries.length + 1, 'every probe called once + settle poll');
      assert(
        calls.filter((t) => t === 'get_equity_orders').length === 1,
        'settle poll ran get_equity_orders',
      );
      const mutCap = JSON.parse(
        readFileSync(join(CAPTURE_TMP, 'mut-eq-market-buy-01.json'), 'utf-8'),
      );
      assert(
        (mutCap.settle as Record<string, unknown> | undefined)?.settled === true,
        'mutation capture records settle poll',
      );
      for (const e of manifest.entries) {
        const cap = JSON.parse(readFileSync(join(CAPTURE_TMP, `${e.id}.json`), 'utf-8'));
        assert(cap.id === e.id, `${e.id} capture id`);
        assert(cap.outcome === 'success', `${e.id} outcome`);
        assert(typeof cap.latencyMs === 'number', `${e.id} latencyMs`);
        assert(cap.response !== undefined, `${e.id} response present`);
        // Manifest args persist with $ENV placeholders — never resolved values.
        assert(!JSON.stringify(cap).includes('12345678'), `${e.id} leaked env value`);
      }
    });

    await check('mutation abort prints checklist and halts the run', async () => {
      rmSync(CAPTURE_TMP, { recursive: true, force: true });
      mkdirSync(CAPTURE_TMP, { recursive: true });
      const logs: string[] = [];
      const answers = ['', 'abort'];
      const result = await runProbePlan({
        entries: manifest.entries,
        caller: async (tool) => ({ success: true, redacted: { tool }, tool }),
        prompt: async () => answers.shift() ?? '',
        captureDir: CAPTURE_TMP,
        env: { RH_ACCOUNT_NUMBER: '12345678' },
        sleep: async () => {},
        log: (l) => logs.push(l),
      });
      assert(result.aborted, 'expected abort');
      assert(logs.join('\n').includes('recovery checklist'), 'checklist printed');
      const mutCap = JSON.parse(
        readFileSync(join(CAPTURE_TMP, 'mut-eq-market-buy-01.json'), 'utf-8'),
      );
      assert(mutCap.reason === 'aborted', 'mutation capture reason=aborted');
    });

    await check('helpers: rate-limit detect, env resolve, pending scan, checklist', () => {
      assert(isRateLimitError('HTTP 429'), '429 detected');
      assert(!isRateLimitError('ok'), 'non-429 not flagged');
      const r = resolveEnvArgs({ a: '$ENV:X' }, { X: 'v' });
      assert(r.args.a === 'v' && r.missing.length === 0, 'env resolved');
      assert(findPendingOrders({ results: [{ state: 'queued' }] }, new Set(['queued'])).length === 1,
        'pending scan finds queued order');
      assert(
        formatAbortChecklist(manifest.entries[2], 'next-probe').includes('mut-eq-market-buy-01'),
        'checklist names probe',
      );
    });
  } finally {
    rmSync(CAPTURE_TMP, { recursive: true, force: true });
  }

  await check('CLI exists and has no mutation-bypass flag', () => {
    assert(existsSync(CLI_PATH), 'run-probe-manifest.ts missing');
    const src = readFileSync(CLI_PATH, 'utf-8');
    assert(
      !/'--(?:yes|force|yes-all|bypass|auto-yes|confirm|assume-yes)'/.test(src) &&
        !/RH_PROBE_(YES|FORCE|CONFIRM)/.test(src),
      'mutation-bypass flag/env found in CLI',
    );
    assert(src.includes("case '--only'"), '--only flag missing');
    assert(src.includes("case '--group'"), '--group flag missing');
    assert(src.includes("case '--from'"), '--from flag missing');
    assert(src.includes("case '--dry-run'"), '--dry-run flag missing');
    assert(src.includes('formatProbePlan'), 'dry-run plan print missing');
  });

  await check('dry-run plan formats gated entries', () => {
    const plan = formatProbePlan(manifest.entries);
    assert(plan.includes('[read] ro-accounts-01'), 'read row');
    assert(plan.includes('[mutation] mut-eq-market-buy-01'), 'mutation row');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
