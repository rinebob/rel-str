/**
 * Drift check (task #682): fetch live `tools/list` from robinhood-trading,
 * diff against the bundled catalog, write captures/00-drift.json.
 *
 * Usage (from functions/):
 *   npx tsx src/rh-agent-mcp/diagnostics/run-drift-check.ts
 *
 * Requires a stored local RH credential (same as executeObservationTool).
 * Exit 0 even on drift — drift is a report, not a failure. Exit 1 on
 * connection/write failure.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffToolCatalog, fetchLiveToolList } from './catalog-drift';
import { loadToolCatalog } from '../tools/robinhood-tools';

const CAPTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'docs',
  'topics',
  '657-rh-mcp',
  'captures',
);
const CAPTURE_PATH = join(CAPTURES_DIR, '00-drift.json');
const LIVE_LIST_PATH = join(CAPTURES_DIR, '01-live-tools-list.json');

async function main() {
  // One fetch, two artifacts: the drift diff AND the full live tools/list
  // dump (the doc assembler needs real schemas for tools absent from the
  // bundled catalog). fetchLiveToolList returns raw server names, which is
  // what the dump should record; diffToolCatalog normalizes internally.
  const live = await fetchLiveToolList();

  const catalog = await loadToolCatalog();
  const drift = diffToolCatalog(live, catalog.tools, {
    catalogGenerated: catalog.generated,
    catalogSource: catalog.source,
  });

  await mkdir(CAPTURES_DIR, { recursive: true });
  await writeFile(CAPTURE_PATH, JSON.stringify(drift, null, 2) + '\n', 'utf-8');
  await writeFile(
    LIVE_LIST_PATH,
    JSON.stringify({ generated: new Date().toISOString(), tools: live }, null, 2) + '\n',
    'utf-8',
  );

  console.log(`catalog generated: ${drift.catalogGenerated ?? 'unknown'}`);
  console.log(`live tools: ${drift.liveToolCount} | catalog tools: ${drift.catalogToolCount}`);
  console.log(`wrote ${CAPTURE_PATH}`);
  console.log(`wrote ${LIVE_LIST_PATH}`);

  if (!drift.hasDrift) {
    console.log('\nNO DRIFT — live tools/list matches the bundled catalog.');
    return;
  }

  console.log('\n*** DRIFT DETECTED ***');
  if (drift.nameCollisions.length) {
    console.log(`collide: ${drift.nameCollisions.join(', ')} (same name after prefix-strip — one entry dropped from the diff)`);
  }
  if (drift.added.length) console.log(`added:   ${drift.added.join(', ')}`);
  if (drift.removed.length) console.log(`removed: ${drift.removed.join(', ')}`);
  for (const r of drift.possiblyRenamed) {
    console.log(`rename?  ${r.from} -> ${r.to} (identical inputSchema + description)`);
  }
  for (const c of drift.changed) {
    console.log(`changed: ${c.tool}`);
    for (const d of c.diffs) console.log(`         ${d}`);
  }
  console.log(
    '\nThe manifest validator runs against the catalog — ' +
      'reconcile added/removed tools before running the sweep.',
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
