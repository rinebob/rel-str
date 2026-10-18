/**
 * sync-savant-ds — refresh `vendor/savant-ds/` from the sibling
 * `../savant-ds` checkout (#1071).
 *
 * Why this exists: App Hosting builds the repo alone — `file:../savant-ds`
 * can't resolve in the cloud workspace. `vendor/savant-ds` is the
 * committed copy the `file:vendor/savant-ds` dependency links to, so the
 * same `node_modules/savant-ds/styles` includePaths work locally and in
 * cloud builds. The sibling checkout stays the source of truth — edit
 * `../savant-ds`, run this script, rebuild.
 *
 * Copies styles/ byte-for-byte and reports a per-file diff summary so a
 * no-op run is visible. Exits 1 when the sibling checkout is missing.
 *
 * Usage: npm run sync:ds
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(ROOT, '..', 'savant-ds', 'styles');
const DST = path.join(ROOT, 'vendor', 'savant-ds', 'styles');

if (!existsSync(SRC)) {
  console.error(`FAIL — sibling checkout not found: ${SRC}`);
  process.exit(1);
}

const list = (dir: string): Map<string, Buffer> => {
  const map = new Map<string, Buffer>();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isFile()) map.set(f.name, readFileSync(path.join(dir, f.name)));
  }
  return map;
};

const srcFiles = list(SRC);
const dstFiles = list(DST);

const added = [...srcFiles.keys()].filter((f) => !dstFiles.has(f));
const removed = [...dstFiles.keys()].filter((f) => !srcFiles.has(f));
const changed = [...srcFiles.keys()].filter(
  (f) => dstFiles.has(f) && !srcFiles.get(f)!.equals(dstFiles.get(f)!),
);

rmSync(DST, { recursive: true, force: true });
mkdirSync(DST, { recursive: true });
for (const [name, buf] of srcFiles) {
  writeFileSync(path.join(DST, name), buf);
}

console.log(`synced ${srcFiles.size} file(s) -> vendor/savant-ds/styles`);
if (added.length) console.log(`  added:   ${added.join(', ')}`);
if (removed.length) console.log(`  removed: ${removed.join(', ')}`);
if (changed.length) console.log(`  changed: ${changed.join(', ')}`);
if (!added.length && !removed.length && !changed.length) {
  console.log('  (no changes — vendor was already in sync)');
}
