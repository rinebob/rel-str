/**
 * CLI: assemble the discovery-doc draft (task #688).
 *
 *   cd functions
 *   npx tsx src/rh-agent-mcp/diagnostics/run-assemble-discovery-doc.ts \
 *     [--manifest <path>] [--captures <dir>] [--tools <json>] \
 *     [--drift <json>] [--out <path>]
 *
 * Defaults point at docs/topics/657-rh-mcp/. Writes the canonical draft to
 * rh-mcp-tool-discovery-canonical-657-658-689.md (pinned in #688/#689).
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleDiscoveryDoc,
  type CaptureRecord,
  type DriftReport,
  type LiveTool,
  type ManifestProbe,
} from './assemble-discovery-doc';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const TOPIC = join(REPO_ROOT, 'docs', 'topics', '657-rh-mcp');

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function main(): void {
  const manifestPath = flag('--manifest', join(TOPIC, 'probe-manifest.json'));
  const capturesDir = flag('--captures', join(TOPIC, 'captures'));
  const toolsPath = flag('--tools', join(capturesDir, '01-live-tools-list.json'));
  const driftPath = flag('--drift', join(capturesDir, '00-drift.json'));
  const outPath = flag(
    '--out',
    join(TOPIC, 'rh-mcp-tool-discovery-canonical-657-658-689.md'),
  );

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const probes: ManifestProbe[] = manifest.probes ?? manifest;

  const toolsRaw = JSON.parse(readFileSync(toolsPath, 'utf-8'));
  const tools: LiveTool[] = Array.isArray(toolsRaw)
    ? toolsRaw
    : toolsRaw.tools ?? toolsRaw.data?.tools;

  const captures: CaptureRecord[] = readdirSync(capturesDir)
    .filter((f) => f.endsWith('.json') && f !== '00-drift.json' && f !== '01-live-tools-list.json')
    .map((f) => JSON.parse(readFileSync(join(capturesDir, f), 'utf-8')));

  const drift: DriftReport | undefined = existsSync(driftPath)
    ? JSON.parse(readFileSync(driftPath, 'utf-8'))
    : undefined;

  const doc = assembleDiscoveryDoc({
    tools,
    probes,
    captures,
    drift,
    generatedAt: new Date().toISOString(),
  });

  writeFileSync(outPath, doc + '\n', 'utf-8');
  console.log(`tools=${tools.length} probes=${probes.length} captures=${captures.length}`);
  console.log(`wrote ${outPath}`);
}

main();
