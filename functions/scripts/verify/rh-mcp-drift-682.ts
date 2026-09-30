/**
 * Verify task #682 — catalog drift check (live tools/list vs bundled
 * catalog). Offline checks only — the real live diff is produced by
 * `npx tsx src/rh-agent-mcp/diagnostics/run-drift-check.ts` (see guide).
 *
 * Checks: catalog file loads with tools, diffToolCatalog classifies
 * added/removed/renamed/changed/unchanged correctly on fixtures, and the
 * runner script + capture path exist.
 *
 * Usage (from functions/): npx tsx scripts/verify/rh-mcp-drift-682.ts
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  diffToolCatalog,
  type DriftToolEntry,
} from '../../src/rh-agent-mcp/diagnostics/catalog-drift';
import { loadToolCatalog } from '../../src/rh-agent-mcp/tools/robinhood-tools';

const DIR = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = join(DIR, '..', '..', 'src', 'rh-agent-mcp', 'diagnostics', 'run-drift-check.ts');
const CAPTURE_PATH = join(DIR, '..', '..', '..', 'docs', 'topics', '657-rh-mcp', 'captures', '00-drift.json');

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
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

const tool = (
  name: string,
  schema: Record<string, unknown> = { type: 'object', properties: {} },
  description = name,
): DriftToolEntry => ({ name, description, inputSchema: schema });

const catalog = await loadToolCatalog();

check('bundled catalog loads with a non-empty tools array', () => {
  assert(Array.isArray(catalog.tools) && catalog.tools.length > 0, 'empty catalog');
  assert(typeof catalog.generated === 'string', 'no generated stamp');
});

check('no drift when lists are identical', () => {
  const drift = diffToolCatalog([tool('a'), tool('b')], [tool('a'), tool('b')]);
  assert(!drift.hasDrift, 'expected no drift');
  assert(drift.unchanged.length === 2, 'expected 2 unchanged');
});

check('added + removed detected; prefixed names normalized', () => {
  const drift = diffToolCatalog(
    [tool('mcp__robinhood-trading__a'), tool('mcp__robinhood-trading__new')],
    [tool('a'), tool('old')],
  );
  assert(drift.added.join() === 'new', `added: ${drift.added}`);
  assert(drift.removed.join() === 'old', `removed: ${drift.removed}`);
});

check('identical-schema rename pair flagged', () => {
  const schema = { type: 'object', required: ['x'], properties: { x: { type: 'string' } } };
  const drift = diffToolCatalog([tool('b', schema, 'same')], [tool('a', schema, 'same')]);
  assert(drift.possiblyRenamed.length === 1, 'no rename pair');
  assert(drift.possiblyRenamed[0].from === 'a' && drift.possiblyRenamed[0].to === 'b', 'wrong pair');
});

check('per-tool inputSchema diffs reported (required, properties, type)', () => {
  const drift = diffToolCatalog(
    [tool('x', { type: 'object', required: ['n'], properties: { n: { type: 'number' }, p: { type: 'string' } } })],
    [tool('x', { type: 'object', properties: { n: { type: 'string' }, q: { type: 'string' } } })],
  );
  assert(drift.changed.length === 1, 'expected 1 changed tool');
  const d = drift.changed[0].diffs.join('\n');
  assert(d.includes('+n') && d.includes('required'), 'missing required diff');
  assert(d.includes('-properties.q'), 'missing removed property');
  assert(d.includes('"string" -> "number"'), 'missing type change');
});

check('runner script + committed drift capture exist', () => {
  assert(existsSync(RUNNER_PATH), 'run-drift-check.ts missing');
  assert(existsSync(CAPTURE_PATH), 'captures/00-drift.json missing — run run-drift-check.ts');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
