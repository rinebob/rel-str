/**
 * Regenerate functions/.rh-mcp-tool-catalog.json from the live tools/list.
 *
 * The bundled catalog is the app's runtime validation baseline (arg
 * checking, manifest validation). The 2026-07-17 snapshot predates 27 tools
 * and newer schema fields (e.g. place_option_order.direction).
 *
 * Safety: this file is DATA only — isObservationTool's ALL_ENABLED_TOOLS
 * allowlist still gates which tools the app can execute, so newly-added
 * catalog entries do not auto-enable anything.
 *
 * Usage (from functions/):
 *   npx tsx src/rh-agent-mcp/diagnostics/refresh-tool-catalog.ts [--dry-run]
 */
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffToolCatalog, fetchLiveToolList } from './catalog-drift';

const CATALOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.rh-mcp-tool-catalog.json',
);

interface ToolCatalog {
  generated: string;
  source: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const live = await fetchLiveToolList();
  if (live.length === 0) {
    throw new Error('live tools/list returned 0 tools — refusing to clobber the catalog');
  }

  const prior: ToolCatalog = JSON.parse(await readFile(CATALOG_PATH, 'utf-8'));
  const drift = diffToolCatalog(live, prior.tools);
  console.log(
    `prior catalog: ${prior.tools.length} tools (${prior.generated}) | live: ${live.length} tools`,
  );
  console.log(
    `added ${drift.added.length}, removed ${drift.removed.length}, changed ${drift.changed.length}`,
  );

  const next: ToolCatalog = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'live tools/list via refresh-tool-catalog.ts',
    tools: live
      .map((t) => ({
        // The server returns short names today; the 2026-07-17 dump used
        // mcp__-prefixed names. All readers strip the prefix via
        // stripServerPrefix, so either form is equivalent — record what
        // the server actually sent.
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };

  if (dryRun) {
    console.log('--dry-run: not writing');
    return;
  }
  // tmp + rename: a mid-write crash must not corrupt the runtime baseline.
  // On Windows rename over an existing file can hit EPERM/EBUSY if the
  // target is open (AV indexer, editor) — retry once, always clean the tmp.
  const tmpPath = `${CATALOG_PATH}.tmp`;
  await writeFile(tmpPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  try {
    try {
      await rename(tmpPath, CATALOG_PATH);
    } catch (firstErr) {
      const code = (firstErr as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY') throw firstErr;
      await new Promise((r) => setTimeout(r, 500));
      try {
        await rename(tmpPath, CATALOG_PATH);
      } catch (secondErr) {
        throw new Error(
          `catalog rename failed twice (first: ${(firstErr as Error).message}): ${(secondErr as Error).message}`,
        );
      }
    }
  } finally {
    await rm(tmpPath, { force: true }).catch(() => undefined);
  }
  console.log(`wrote ${CATALOG_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
