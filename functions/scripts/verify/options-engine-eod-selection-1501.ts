/**
 * Verify — #1501 Engine config + eod-selection-pass re-target.
 *
 * DRY stage (default, no credentials): drives `runEodSelectionPass` with a
 * fake `getEodChain` provider through the REAL shared coordinate selector
 * — signed-delta argmin, nearest-DTE expiration, no-contract → null,
 * deltaTolerance post-check, malformed-candidate rejection, quote
 * mapping — plus the concrete-DTE id segments (`buildPositionId`,
 * `generateInstanceId`).
 *
 * LIVE stage (`--live`, needs ADC + GOOGLE_CLOUD_PROJECT=rel-str + IPv4
 * preload): fetches a REAL SPY EOD chain via the deployed partner
 * historical-options endpoint, runs `runEodSelectionPass` with the real
 * `AvEodOptionQuoteProvider`, and asserts the result equals the shared
 * selector applied to the same chain. Also writes a real
 * `st-strategy-instances/verify-1501-*` doc carrying the new concrete
 * vocabulary (`dte`, signed `targetDelta`) with `enabled:false`, reads it
 * back through `getInstance` (the real validate+normalize path), then
 * DELETES it — a `verify-*` doc left in the live instance collection
 * could be re-enabled by a console edit and fire real engine runs.
 */

import {
  OptionType,
  PositionSpreadType,
  StrategyFrequency,
  selectContractAtCoordinate,
} from '@options/common';
import { TradeSide } from '@common';
import {
  ExitPolicy,
  LifecycleState,
} from '@options-strategy-engine/contracts';
import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';
import type { HistoricalOptionContract } from '@options-contract/contracts';
import { runEodSelectionPass } from '../../src/paper-trading/engine/selection/eod-selection-pass';
import { AvEodOptionQuoteProvider } from '../../src/paper-trading/engine/quote-providers/av-eod-option-quote-provider';
import { buildPositionId } from '../../src/paper-trading/engine/position-ids';
import { generateInstanceId } from '../../../shared/strategy-instance-id';
import { ST_STRATEGY_INSTANCES_ROOT } from '@st/collections';

const LIVE = process.argv.includes('--live');
let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  ok ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ==========================
// DRY — fake chain through the real pass + shared selector
// ==========================

const MARKET = '2026-01-05';
// marketDate + 30d ≈ 2026-02-04; nearest listed expiries 2026-02-06 (32d)
// and 2026-03-06 (60d) → 32d expiry wins.
const EXP_NEAR = '2026-02-06';
const EXP_FAR = '2026-03-06';

const c = (over: Partial<HistoricalOptionContract>): HistoricalOptionContract => ({
  contractID: 'SPY260206P00580000',
  expiration: EXP_NEAR,
  type: OptionType.PUT,
  strike: '580',
  delta: '-0.30',
  mark: '9.50',
  bid: '9.40',
  ask: '9.60',
  ...over,
});

const CSP: StrategyInstanceConfig = {
  id: 'verify-1501-csp',
  symbol: 'SPY',
  optionType: OptionType.PUT,
  side: TradeSide.SHORT,
  targetDelta: -0.3,
  dte: 30,
  phases: [{ spreadType: PositionSpreadType.CASH_SECURED_PUT, targetDelta: -0.3, dte: 30 }],
  frequency: StrategyFrequency.DAILY,
  openTimePT: '12:00',
  exitPolicies: [{ policy: ExitPolicy.WHEEL_IF_ASSIGNED }],
  lifecycleState: LifecycleState.ACTIVE,
  userId: 'verify',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const fakeProvider = (chain: HistoricalOptionContract[]) => ({
  getEodChain: async () => chain,
});

async function dry(): Promise<void> {
  console.log('DRY — runEodSelectionPass over fake chain');

  // 1. Signed put delta: within the nearest expiry, argmin |delta − (−0.3)|
  //    picks −0.28 over −0.10 (signed, not absolute, comparison).
  {
    const chain = [
      c({ contractID: 'P1', delta: '-0.28' }),
      c({ contractID: 'P2', delta: '-0.10' }),
      c({ contractID: 'P3', expiration: EXP_FAR, delta: '-0.30' }),
    ];
    const r = await runEodSelectionPass(MARKET, CSP, fakeProvider(chain));
    ok('signed-put argmin within nearest expiry', r?.selected.contractId === 'P1', String(r?.selected.contractId));
  }

  // 2. Concrete DTE picks the nearest-DTE expiration (32d over 60d for dte:30).
  {
    const chain = [
      c({ contractID: 'NEAR', expiration: EXP_NEAR, delta: '-0.25' }),
      c({ contractID: 'FAR', expiration: EXP_FAR, delta: '-0.30' }),
    ];
    const r = await runEodSelectionPass(MARKET, CSP, fakeProvider(chain));
    ok('nearest-DTE expiration wins over better delta farther out',
      r?.selected.contractId === 'NEAR' && r?.dte === 32,
      `${r?.selected.contractId} dte=${r?.dte}`);
  }

  // 3. No eligible contract → null.
  {
    const chain = [c({ type: OptionType.CALL, delta: '0.30' })];
    const r = await runEodSelectionPass(MARKET, CSP, fakeProvider(chain));
    ok('no eligible contract → null', r === null);
    const empty = await runEodSelectionPass(MARKET, CSP, fakeProvider([]));
    ok('empty chain → null', empty === null);
  }

  // 4. deltaTolerance is a signed-distance post-check.
  {
    const chain = [c({ delta: '-0.50' })]; // distance 0.20
    const loose = await runEodSelectionPass(MARKET, { ...CSP, deltaTolerance: 0.25 }, fakeProvider(chain));
    const tight = await runEodSelectionPass(MARKET, { ...CSP, deltaTolerance: 0.05 }, fakeProvider(chain));
    ok('deltaTolerance within → result', loose !== null);
    ok('deltaTolerance breach → null', tight === null);
  }

  // 5. Malformed candidates are ignored, not fabricated.
  {
    const chain = [
      c({ contractID: 'BAD_DELTA', delta: 'n/a' }),
      c({ contractID: 'BAD_STRIKE', strike: 'abc' }),
      c({ contractID: 'BAD_EXP', expiration: undefined }),
      c({ contractID: '', delta: '-0.30' }),
      c({ contractID: 'EXPIRED', expiration: '2025-12-01' }),
      c({ contractID: 'GOOD', delta: '-0.30' }),
    ];
    const r = await runEodSelectionPass(MARKET, CSP, fakeProvider(chain));
    ok('malformed candidates ignored → GOOD selected', r?.selected.contractId === 'GOOD', String(r?.selected.contractId));
  }

  // 6. Quote mapping — side + mark + contractID flow through the real mapper.
  {
    const chain = [c({ contractID: 'SPY260206P00580000', mark: '9.50' })];
    const r = await runEodSelectionPass(MARKET, CSP, fakeProvider(chain));
    ok('quote contractID mapped', r?.quote.contractID === 'SPY260206P00580000');
    ok('quote side = config side', r?.quote.side === TradeSide.SHORT);
    ok('quote mark finite', Number.isFinite(r?.quote.mark), String(r?.quote.mark));
    ok('result.dte = selected dte', r?.dte === 32);
  }

  // 7. Missing concrete coordinate → null.
  {
    const noDelta = await runEodSelectionPass(MARKET, { ...CSP, targetDelta: undefined }, fakeProvider([c({})]));
    const noDte = await runEodSelectionPass(MARKET, { ...CSP, dte: undefined }, fakeProvider([c({})]));
    ok('missing targetDelta → null', noDelta === null);
    ok('missing dte → null', noDte === null);
  }

  // 8. Positive call delta: covered-call config selects nearest signed delta.
  {
    const cc: StrategyInstanceConfig = {
      ...CSP,
      optionType: OptionType.CALL,
      targetDelta: 0.3,
      phases: [{ spreadType: PositionSpreadType.COVERED_CALL, targetDelta: 0.3, dte: 30 }],
    };
    const chain = [
      c({ contractID: 'C1', type: OptionType.CALL, delta: '0.32' }),
      c({ contractID: 'C2', type: OptionType.CALL, delta: '0.60' }),
    ];
    const r = await runEodSelectionPass(MARKET, cc, fakeProvider(chain));
    ok('signed-call argmin', r?.selected.contractId === 'C1', String(r?.selected.contractId));
  }

  // 9. Id segments carry the concrete dte.
  {
    const posId = buildPositionId(CSP, MARKET);
    ok('position id carries concrete dte', posId.includes('-030-30-'), posId);
    const instId = generateInstanceId(
      new Date('2026-01-05T00:00:00Z'),
      'SPY',
      CSP.phases,
      StrategyFrequency.DAILY,
      '12:00',
    );
    ok('instance id carries |delta| + concrete dte', instId.includes('-030-30-'), instId);
  }
}

// ==========================
// LIVE — real chain fetch + real instance doc validation
// ==========================

async function live(): Promise<void> {
  console.log('LIVE — real AV chain + real instance doc path');
  // Imported here (not statically) so DRY/run-all never loads firebase
  // admin — initializeApp() is eager at module load. `db` comes back
  // with the project's standard settings already applied.
  const { db: fdb } = await import('../../src/firebase-admin-init');
  const { getInstance } = await import(
    '../../src/paper-trading/engine/strategy-instance-repository'
  );

  // Real chain → real pass → must equal shared selector over the same rows.
  const provider = new AvEodOptionQuoteProvider();
  const asOf = '2026-01-30'; // recent trading day
  const chain = await provider.getEodChain('SPY', asOf);
  ok('live chain non-empty', chain.length > 0, `${chain.length} contracts`);
  const liveResult = await runEodSelectionPass(asOf, CSP, provider);
  const manual = selectContractAtCoordinate(asOf, chain, {
    type: CSP.optionType,
    targetDelta: CSP.targetDelta!,
    dte: CSP.dte!,
  });
  if (manual === null) {
    ok('live pass null == selector null', liveResult === null);
  } else {
    ok('live pass picks same contractId as shared selector',
      liveResult?.selected.contractId === manual.contractId,
      `${liveResult?.selected.contractId} vs ${manual.contractId}`);
    ok('live result dte matches selector', liveResult?.dte === manual.dte);
  }

  // Real doc → real validate+normalize via getInstance → delete (the doc is
  // live-actionable; leaving it risks a console enable firing real runs).
  const docId = `verify-1501-${Date.now()}`;
  const docRef = fdb.collection(ST_STRATEGY_INSTANCES_ROOT).doc(docId);
  try {
    await docRef.set({
      ...CSP,
      id: docId,
      mode: 'paper',
      enabled: false, // keep it out of listRunnableInstances
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const inst = await getInstance(docId, fdb);
    ok('real doc validates + normalizes', inst !== null);
    ok('doc carries concrete dte', inst?.dte === 30, String(inst?.dte));
    ok('doc carries signed targetDelta', inst?.targetDelta === -0.3, String(inst?.targetDelta));
    ok('doc phase carries concrete dte', inst?.phases?.[0]?.dte === 30);
  } finally {
    await docRef.delete(); // idempotent — safe even if set() threw
  }
  const after = await docRef.get();
  ok('verify doc deleted (live-actionable collection)', !after.exists);

  // Sign/type mismatch must now fail isValidInstance — an unsigned put
  // target would otherwise argmin the least-negative put every night.
  const badId = `verify-1501-bad-${Date.now()}`;
  const badRef = fdb.collection(ST_STRATEGY_INSTANCES_ROOT).doc(badId);
  try {
    await badRef.set({
      ...CSP,
      id: badId,
      targetDelta: 0.3, // unsigned — contradicts optionType PUT
      mode: 'paper',
      enabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ok('unsigned put target rejected by real validate path',
      (await getInstance(badId, fdb)) === null);
  } finally {
    await badRef.delete();
  }
  const badAfter = await badRef.get();
  ok('rejected-doc cleanup verified', !badAfter.exists);
}

async function main(): Promise<void> {
  await dry();
  if (LIVE) await live();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
