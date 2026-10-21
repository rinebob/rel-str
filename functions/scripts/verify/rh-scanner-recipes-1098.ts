/**
 * Verify task #1141 — every SCANNER_RECIPES catalog recipe through
 * preview_scan on the real session (the live tripwire per IMPL §5).
 *
 * Imports the FE catalog directly — the relay asserts the recipes the
 * page actually ships, not a copy that can drift. For each recipe:
 *
 *   1. preview_scan succeeds (executor transport + tool call).
 *   2. data.result conforms to PreviewScanResult (total_items number,
 *      results rows with ticker/instrument_id/instrument_type strings
 *      and string-valued columns — schema-drift tripwire).
 *   3. WARN (not fail) when a requested column key is absent from EVERY
 *      returned row — canonicalization drift surfaces here first; the
 *      page's presence-verified lookup tolerates renames, but a recipe
 *      whose key column vanishes entirely wants a human look.
 *
 * Empty result sets are NOT failures — losers/52w-low recipes can
 * legitimately match nothing in a window. Preview persists nothing.
 *
 * Needs the local RH MCP session (DPAPI credentials) — same env as
 * rh-scanner-contracts-1131.ts.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/rh-scanner-recipes-1098.ts
 */
// Cross-boundary import: this script reaches into src/app — the first
// functions script to do so. It stays valid only while the chain
// (scanner-recipes → scanner-rows.util) keeps its Angular-facing
// imports type-only; a runtime import there would break tsx, not tsc.
import { SCANNER_RECIPES } from '../../../src/app/features/savant-trader/scanner/scanner-recipes';
import type {
  PreviewScanResponse,
  PreviewScanResult,
  ScanColumn,
  ScanFilter,
  ScanResultRow,
} from '../../../shared/robinhood-mcp-contracts';
import { executeObservationTool } from '../../src/rh-agent-mcp/tools/robinhood-tool-executor';

let passed = 0;
let failed = 0;
let warned = 0;

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

function warn(name: string, msg: string): void {
  warned++;
  console.warn(`WARN  ${name}: ${msg}`);
}

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

async function preview(
  filters: readonly ScanFilter[],
  columns: readonly ScanColumn[] | undefined,
): Promise<PreviewScanResult> {
  const res = await executeObservationTool('preview_scan', { filters, columns });
  assert(res.success, `preview_scan failed: ${res.success ? '' : res.error}`);
  if (res.success) {
    // success:true + toolError = transport fine but the MCP tool itself
    // errored — surface its text, not a generic "missing data.result".
    assert(!res.toolError, `preview_scan tool error: ${res.toolError}`);
  }
  // parsed carries the decoded JSON; redacted is the raw envelope when
  // parsed is absent — it can never satisfy data.result, so don't
  // pretend it's a fallback.
  const payload = (res.success ? res.parsed : null) as PreviewScanResponse;
  assert(!!payload?.data?.result, 'parsed payload missing data.result');
  return payload.data.result;
}

function checkRowShape(label: string, result: PreviewScanResult): void {
  check(`${label}: result shape — total_items >= results.length`, () => {
    assert(typeof result.total_items === 'number', 'total_items not a number');
    assert(
      result.total_items >= result.results.length,
      'total_items < rows returned',
    );
  });
  check(`${label}: rows carry ticker/instrument_id/instrument_type + string columns`, () => {
    for (const row of result.results) {
      assert(
        typeof row.ticker === 'string' && row.ticker.length > 0,
        'missing ticker',
      );
      assert(typeof row.instrument_id === 'string', 'missing instrument_id');
      assert(typeof row.instrument_type === 'string', 'missing instrument_type');
      for (const [k, v] of Object.entries(row.columns)) {
        assert(
          typeof k === 'string' && typeof v === 'string',
          `column ${k} not string: ${typeof v}`,
        );
      }
    }
  });
}

console.log('rh-scanner-recipes-1098 — live preview_scan per catalog recipe\n');

const ids = new Set<string>();
for (const recipe of SCANNER_RECIPES) {
  check(`catalog: '${recipe.id}' unique + non-empty filters`, () => {
    assert(!ids.has(recipe.id), `duplicate recipe id ${recipe.id}`);
    ids.add(recipe.id);
    assert(recipe.filters.length > 0, 'no filters');
  });
}

for (const recipe of SCANNER_RECIPES) {
  console.log(`\n▶ ${recipe.id} — ${recipe.title}`);
  // Per-recipe isolation — the issue asks for EVERY recipe exercised;
  // one transport/tool failure must not abort the rest of the catalog.
  let result: PreviewScanResult;
  try {
    result = await preview(recipe.filters, recipe.columns);
  } catch (error) {
    failed++;
    console.error(
      `FAIL  ${recipe.id}: preview_scan — ${error instanceof Error ? error.message : String(error)}`,
    );
    continue;
  }
  checkRowShape(recipe.id, result);
  console.log(
    `      ${result.results.length} rows · total_items ${result.total_items}` +
      `${result.sorted_by ? ` · sorted ${result.sorted_by}` : ''}`,
  );
  // Column-key coverage — WARN only: a legitimately sparse column
  // (blank fundamentals everywhere) is not drift. Absent from EVERY
  // row AND the static lookup's canonical name absent too is the
  // drift signature worth flagging. The guards keep a drifted
  // results/columns shape — the very thing this block exists to
  // catch — from escaping as an uncaught crash (checkRowShape
  // already logged it as a contained FAIL).
  if (Array.isArray(result.results) && result.results.length > 0) {
    for (const col of recipe.columns) {
      const keys = new Set<string>([col.display_name]);
      const rename = recipe.columnLookup?.get(col.display_name);
      if (rename) keys.add(rename);
      const present = result.results.some(
        (r: ScanResultRow) =>
          !!r &&
          typeof r.columns === 'object' &&
          r.columns !== null &&
          [...keys].some((k) => Object.hasOwn(r.columns, k)),
      );
      if (!present) {
        warn(
          recipe.id,
          `column '${col.display_name}' (canonical '${rename ?? '—'}') absent from all ${result.results.length} rows`,
        );
      }
    }
  }
}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed, ${warned} warned ===`);
process.exit(failed > 0 ? 1 : 0);
