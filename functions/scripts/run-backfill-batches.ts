/**
 * Runs the symbol-data sync backfill in batches for a symbol list read from a file.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/run-backfill-batches.ts
 *
 * Override defaults:
 *   $env:BATCH_SIZE="50"
 *   $env:SYMBOL_FILE="scripts/symbols-to-backfill.txt"
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const filePath = resolve(process.env.SYMBOL_FILE ?? resolve(scriptDir, 'symbols-to-backfill.txt'));
const batchSize = Number(process.env.BATCH_SIZE ?? 50);
const raw = readFileSync(filePath, 'utf-8');
const allSymbols = raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);

console.log(`Loaded ${allSymbols.length} symbols from ${filePath}`);
console.log(`Batch size: ${batchSize}`);

function runBatch(batch: string[], index: number) {
  console.log(`\nBatch ${index + 1}: ${batch.length} symbols`);
  try {
    const result = execSync(
      `npx tsx ${resolve(scriptDir, 'trigger-bars-backfill.ts')} ${batch.join(' ')}`,
      { encoding: 'utf-8', stdio: 'inherit' }
    );
  } catch (err: any) {
    console.error(`Batch ${index + 1} failed`);
    process.exitCode = 1;
  }
}

for (let i = 0; i < allSymbols.length; i += batchSize) {
  const batch = allSymbols.slice(i, i + batchSize);
  runBatch(batch, i / batchSize);
}

console.log(`\nDone. Enqueued ${allSymbols.length} symbols in batches.`);
