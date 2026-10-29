/**
 * Verification (OFFLINE): get_equity_historicals wire contract (task #1304).
 *
 * Capture parity — every request-arg / top-level-response / result-entry /
 * bar key observed in the live captures
 * (docs/topics/657-rh-mcp/captures/ro-eq-hist-*.json) must be a field declared
 * in @robinhood-mcp/contracts, and vice versa. The `Record<keyof T, true>`
 * maps are exhaustive at compile time — adding an interface field without
 * updating a map fails typecheck; a wire field missing from the contract
 * fails here at runtime (and a declared field never seen on the wire warns).
 *
 * The live-call stage lives in the sibling script
 * savant-trader-scanner-row-actions-1304-live.ts — it needs the RH MCP
 * executor at 127.0.0.1:3456 and is deliberately NOT registered in
 * run-all.ts (same convention as run-drift-check.ts for #682).
 *
 * Usage: npx tsx scripts/verify/savant-trader-scanner-row-actions-1304-contracts.ts
 *
 * No credentials, no services — capture files on disk only.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  EquityHistoricalsRequest,
  EquityHistoricalBar,
  EquityHistoricalsSymbolResult,
  EquityHistoricalsResult,
} from '@robinhood-mcp/contracts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAPTURES_DIR = join(REPO_ROOT, 'docs', 'topics', '657-rh-mcp', 'captures');

let failures = 0;
function ok(msg: string): void {
  console.log(`OK   ${msg}`);
}
function warn(msg: string): void {
  console.log(`WARN ${msg}`);
}
function fail(msg: string): void {
  failures++;
  console.log(`FAIL ${msg}`);
}

// Exhaustive declared-field maps — `Record<keyof T, true>` means adding a
// field to the interface without updating the map is a compile error.
const REQUEST_KEYS: Record<keyof EquityHistoricalsRequest, true> = {
  symbols: true,
  start_time: true,
  end_time: true,
  interval: true,
  bounds: true,
  adjustment_type: true,
};
const RESPONSE_KEYS: Record<keyof EquityHistoricalsResult, true> = {
  data: true,
  guide: true,
};
const DATA_KEYS: Record<keyof EquityHistoricalsResult['data'], true> = {
  results: true,
};
const RESULT_KEYS: Record<keyof EquityHistoricalsSymbolResult, true> = {
  symbol: true,
  interval: true,
  bounds: true,
  bars: true,
};
const BAR_KEYS: Record<keyof EquityHistoricalBar, true> = {
  begins_at: true,
  open_price: true,
  close_price: true,
  high_price: true,
  low_price: true,
  volume: true,
  session: true,
  interpolated: true,
};

function checkKeys(kind: string, declared: Record<string, true>, seen: Set<string>): void {
  const declaredKeys = Object.keys(declared);
  for (const key of seen) {
    if (key in declared) {
      ok(`${kind} field '${key}' is declared in the contract`);
    } else {
      fail(`${kind} field '${key}' appears on the wire but is NOT declared in the contract`);
    }
  }
  for (const key of declaredKeys) {
    if (!seen.has(key)) {
      warn(`${kind} field '${key}' is declared but never observed in these captures`);
    }
  }
}

function main(): void {
  const files = readdirSync(CAPTURES_DIR).filter((f) => /^ro-eq-hist-.*\.json$/.test(f));
  if (files.length === 0) {
    fail(`no ro-eq-hist-*.json captures found under ${CAPTURES_DIR}`);
    process.exit(1);
  }
  ok(`found ${files.length} equity-historicals captures`);

  const seenArgs = new Set<string>();
  const seenResponse = new Set<string>();
  const seenData = new Set<string>();
  const seenResult = new Set<string>();
  const seenBar = new Set<string>();
  for (const file of files) {
    const cap = JSON.parse(readFileSync(join(CAPTURES_DIR, file), 'utf8'));
    for (const k of Object.keys(cap.args ?? {})) seenArgs.add(k);
    for (const k of Object.keys(cap.response ?? {})) seenResponse.add(k);
    for (const k of Object.keys(cap.response?.data ?? {})) seenData.add(k);
    // Structural assert — without it a capture whose `data` lacks `results`
    // degrades to warnings and a false PASS.
    if (!Array.isArray(cap.response?.data?.results)) {
      fail(`${file}: response.data.results is absent or not an array`);
      continue;
    }
    for (const r of cap.response.data.results) {
      for (const k of Object.keys(r)) seenResult.add(k);
      for (const b of r.bars ?? []) {
        for (const k of Object.keys(b)) seenBar.add(k);
      }
    }
  }

  checkKeys('request arg', REQUEST_KEYS, seenArgs);
  checkKeys('response top-level', RESPONSE_KEYS, seenResponse);
  checkKeys('data-level', DATA_KEYS, seenData);
  checkKeys('result-entry', RESULT_KEYS, seenResult);
  checkKeys('bar', BAR_KEYS, seenBar);

  console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures} check(s) failed)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
