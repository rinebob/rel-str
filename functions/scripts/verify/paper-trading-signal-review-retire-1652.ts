/**
 * @topic #553 — Paper Trading Infra (task #1652)
 *
 * Verify for the auto-mint retirement — `st-config/autoPaper.enabled
 * = false` is the retirement mechanism; `runAutoPaperIngestPass` +
 * `runAutoPaperIngestFill` stay deployed-inert (no code changes).
 *
 *   npx tsx scripts/verify/paper-trading-signal-review-retire-1652.ts
 *     DRY — fixture configs through the REAL gate function: disabled →
 *     skipped/'disabled', enabled → ready (the check is discriminating,
 *     not vacuous), missing config → skipped/'missing-config'. No
 *     credentials.
 *
 *   npx tsx scripts/verify/paper-trading-signal-review-retire-1652.ts --live
 *     Read-only prod assertions (needs ADC):
 *       - st-config/autoPaper.enabled === false (post-flip)
 *       - zero non-accept-flow source==SIGNAL trades (post-#1651 wipe)
 *       - the real gate returns skipped/'disabled' on a nightly payload
 *         — the next dispatched ingest returns before quoting/minting.
 *
 * The ops flip itself is a user-executed config write (see .md).
 */
import {
  defaultAutoPaperIngestDeps,
  runAutoPaperIngestPass,
  type AutoPaperIngestDeps,
} from '../../src/paper-trading/passes/auto-paper-ingest-pass';
import type { AutoPaperConfig } from '../../src/common/st-collections';
import type { AutoPaperIngestPayload } from '../../src/common/st-shared-types';
import {
  groomProdDeps,
  isAcceptFlowMarker,
} from '../groom-legacy-signal-trades';

const LIVE = process.argv.includes('--live');

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const PAYLOAD: AutoPaperIngestPayload = {
  runId: 'verify-1652',
  marketDate: '2026-11-23',
  triggeredBy: 'nightly',
};

function depsWith(config: AutoPaperConfig | null): AutoPaperIngestDeps {
  return {
    loadConfig: async () => config,
    todayPT: () => '2026-11-23',
  };
}

// ── DRY — fixture configs through the real gate ─────────────────────────────

async function dry(): Promise<void> {
  console.log('— gate discrimination (fixture configs) —');
  const disabled = await runAutoPaperIngestPass(
    PAYLOAD,
    depsWith({ enabled: false, lists: ['PRIMARY'] }),
  );
  check(
    "enabled:false → skipped/'disabled'",
    disabled.status === 'skipped' && disabled.reason === 'disabled',
    JSON.stringify(disabled),
  );

  const enabled = await runAutoPaperIngestPass(
    PAYLOAD,
    depsWith({ enabled: true, lists: ['PRIMARY'] }),
  );
  check(
    "enabled:true + nightly + live date → 'ready'",
    enabled.status === 'ready',
    JSON.stringify(enabled),
  );

  const missing = await runAutoPaperIngestPass(PAYLOAD, depsWith(null));
  check(
    "missing config → skipped/'missing-config'",
    missing.status === 'skipped' && missing.reason === 'missing-config',
    JSON.stringify(missing),
  );

  const disabledHistoric = await runAutoPaperIngestPass(
    { ...PAYLOAD, marketDate: '2026-01-01' },
    depsWith({ enabled: false, lists: ['PRIMARY'] }),
  );
  check(
    'disabled wins even on a historical date (config gate precedes date gate)',
    disabledHistoric.status === 'skipped' &&
      disabledHistoric.reason === 'disabled',
    JSON.stringify(disabledHistoric),
  );
}

// ── LIVE — real Firestore (needs ADC, read-only) ────────────────────────────

async function live(): Promise<void> {
  console.log('LIVE — real Firestore (st-config/autoPaper + signal trades)');

  const deps = defaultAutoPaperIngestDeps();
  const config = await deps.loadConfig();
  check(
    'st-config/autoPaper.enabled === false',
    config !== null && config.enabled === false,
    `enabled=${config?.enabled} (flip not applied yet?)`,
  );

  const rows = await groomProdDeps().listSignalTrades();
  // Post-wipe residue — same marker predicate the groom skips on and
  // deleteTradeCascade enforces; surviving accept-flow docs are
  // expected and preserved.
  const legacy = rows.filter((r) => !isAcceptFlowMarker(r));
  check(
    'zero non-accept-flow source==SIGNAL trades (post-wipe)',
    legacy.length === 0,
    `${legacy.length} remain: ${legacy.map((r) => r.id).join(', ')}`,
  );
  console.log(
    `census: ${rows.length} signal-source trades — ` +
      `${legacy.length} legacy residue, ` +
      `${rows.length - legacy.length} accept-flow (preserved)`,
  );

  const gate = await runAutoPaperIngestPass(PAYLOAD, deps);
  check(
    "real gate → skipped/'disabled' — next dispatched ingest mints nothing",
    gate.status === 'skipped' && gate.reason === 'disabled',
    JSON.stringify(gate),
  );
}

await dry();
if (LIVE) await live();
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
