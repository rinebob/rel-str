/**
 * @topic #657 — Robinhood MCP (task #681 — probe manifest loader)
 *
 * Verifies the probe-manifest pipeline for real (no MCP connection needed):
 *
 *   1. loads the real docs/topics/657-rh-mcp/probe-manifest.json from disk
 *   2. validates it against the bundled/live-catalog tool set
 *   3. prints the dry-run plan (gate classification per probe)
 *   4. negative checks: mutation gated 'read' and unknown tool both error
 *
 * Usage: cd functions && npx tsx scripts/verify/rh-mcp-manifest-681.ts
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatProbePlan,
  loadProbeManifest,
  validateProbeManifest,
} from '../../src/rh-agent-mcp/diagnostics/probe-manifest';
import { listObservationTools } from '../../src/rh-agent-mcp/tools/robinhood-tools';

const MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/topics/657-rh-mcp/probe-manifest.json',
);

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1;
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
  }
}

async function main(): Promise<void> {
  const tools = await listObservationTools();
  const liveNames = new Set(tools.map((t) => t.name));

  console.log(`Loading ${MANIFEST_PATH}`);
  const result = await loadProbeManifest(MANIFEST_PATH, { knownTools: tools });

  check('manifest loads with zero errors', result.ok, result.errors);
  check('entries populated', result.entries.length > 0, result.entries.length);

  for (const entry of result.entries) {
    check(
      `probe "${entry.id}" valid shape`,
      entry.id.length > 0 &&
        liveNames.has(entry.tool) &&
        (entry.gate === 'read' || entry.gate === 'mutation') &&
        entry.group.length > 0,
      entry,
    );
  }

  const envProbe = result.entries.find((e) => e.requiredEnv.length > 0);
  check(
    'env placeholders annotated (RH_ACCOUNT_NUMBER resolved lazily)',
    !!envProbe && envProbe.requiredEnv.includes('RH_ACCOUNT_NUMBER'),
    envProbe,
  );

  const plan = formatProbePlan(result.entries);
  console.log('\nPlan:\n' + plan + '\n');
  check(
    'plan lists every entry once',
    plan.split('\n').length === result.entries.length,
  );

  // Negative checks — the gates that keep a bad manifest from ever running.
  const mutationGatedRead = validateProbeManifest(
    {
      probes: [
        {
          id: 'unsafe',
          tool: 'place_equity_order',
          args: {
            account_number: '$ENV:RH_ACCOUNT_NUMBER',
            symbol: 'OOMA',
            side: 'buy',
            type: 'market',
          },
          group: 'x',
          gate: 'read',
        },
      ],
    },
    { knownTools: tools },
  );
  check(
    'mutation tool gated "read" is rejected',
    !mutationGatedRead.ok &&
      mutationGatedRead.errors.some((e) => e.probeId === 'unsafe'),
    mutationGatedRead.errors,
  );

  const unknownTool = validateProbeManifest(
    {
      probes: [
        { id: 'x', tool: 'not_a_real_tool', args: {}, group: 'x', gate: 'read' },
      ],
    },
    { knownTools: tools },
  );
  check(
    'unknown tool is rejected, named in error',
    !unknownTool.ok && unknownTool.errors.some((e) => e.message.includes('not_a_real_tool')),
    unknownTool.errors,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
