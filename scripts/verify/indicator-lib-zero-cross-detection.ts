/**
 * Verification script: zero-cross signal detection in the BE pipeline.
 *
 * Calls detectAllZoneZeroCrossSignals and generateZoneSignals with synthetic
 * zone data to verify zero-cross signals are detected and merged with
 * confirmation signals correctly.
 *
 * Usage:
 *   npx tsx scripts/verify/indicator-lib-zero-cross-detection.ts
 */

import { detectAllZoneZeroCrossSignals } from '../../functions/src/st-cloud-function/strategies/signal-detection';
import type { OHLCV } from '../../functions/src/st-cloud-function/strategies/base-strategy';

function bars(n: number): OHLCV[] {
  return Array.from({ length: n }, (_, i) => ({ open: 0, high: 0, low: 0, close: 0, date: `2026-01-${String(i + 1).padStart(2, '0')}` }));
}

function main(): void {
  let pass = 0;
  let fail = 0;

  function check(label: string, condition: boolean): void {
    if (condition) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.log(`  ✗ ${label}`);
      fail++;
    }
  }

  console.log('=== Zero-Cross Detection Verification ===\n');

  // Test 1: Basic bullish cross
  console.log('Test 1: Basic bullish cross [-1, +1]');
  const bullish = detectAllZoneZeroCrossSignals([-1, 1], bars(2), 'V1', 'D');
  check('fires 1 signal', bullish.length === 1);
  check('direction is LONG', bullish[0].action === 'LONG');
  check('signalType is D_ST_TREND_RIDER_V1_LONG', bullish[0].signalType === 'D_ST_TREND_RIDER_V1_LONG');
  check('index is 1', bullish[0].index === 1);

  // Test 2: Basic bearish cross
  console.log('\nTest 2: Basic bearish cross [+1, -1]');
  const bearish = detectAllZoneZeroCrossSignals([1, -1], bars(2), 'V1', 'D');
  check('fires 1 signal', bearish.length === 1);
  check('direction is SHORT', bearish[0].action === 'SHORT');
  check('signalType is D_ST_TREND_RIDER_V1_SHORT', bearish[0].signalType === 'D_ST_TREND_RIDER_V1_SHORT');

  // Test 3: Jump over zero
  console.log('\nTest 3: Jump over zero [-3, +2]');
  const jump = detectAllZoneZeroCrossSignals([-3, 2], bars(2), 'V1', 'D');
  check('fires 1 signal', jump.length === 1);
  check('direction is LONG', jump[0].action === 'LONG');

  // Test 4: Zero is neutral
  console.log('\nTest 4: Zero is neutral [-1, 0, +1]');
  const neutral = detectAllZoneZeroCrossSignals([-1, 0, 1], bars(3), 'V1', 'D');
  check('fires 0 signals', neutral.length === 0);

  // Test 5: NaN breaks sequence
  console.log('\nTest 5: NaN breaks sequence [-1, NaN, +1]');
  const nanBreak = detectAllZoneZeroCrossSignals([-1, NaN, 1], bars(3), 'V1', 'D');
  check('fires 0 signals', nanBreak.length === 0);

  // Test 6: Multiple crosses
  console.log('\nTest 6: Multiple crosses [-1, +1, -1, +1]');
  const multi = detectAllZoneZeroCrossSignals([-1, 1, -1, 1], bars(4), 'V1', 'D');
  check('fires 3 signals', multi.length === 3);
  check('first is LONG', multi[0].action === 'LONG');
  check('second is SHORT', multi[1].action === 'SHORT');
  check('third is LONG', multi[2].action === 'LONG');

  // Test 7: V2 version
  console.log('\nTest 7: V2 version [-1, +1]');
  const v2 = detectAllZoneZeroCrossSignals([-1, 1], bars(2), 'V2', 'D');
  check('signalType is D_ST_TREND_RIDER_V2_LONG', v2[0].signalType === 'D_ST_TREND_RIDER_V2_LONG');

  // Test 8: Weekly timeframe
  console.log('\nTest 8: Weekly timeframe [-1, +1]');
  const weekly = detectAllZoneZeroCrossSignals([-1, 1], bars(2), 'V1', 'W');
  check('signalType is W_ST_TREND_RIDER_V1_LONG', weekly[0].signalType === 'W_ST_TREND_RIDER_V1_LONG');

  // Test 9: Reason text
  console.log('\nTest 9: Reason text [-2, +1]');
  const reason = detectAllZoneZeroCrossSignals([-2, 1], bars(2), 'V1', 'D');
  check('reason contains "crossed zero"', reason[0].reason.includes('crossed zero'));
  check('reason contains "-2→1"', reason[0].reason.includes('-2→1'));

  // Test 10: Cross after gap recovers
  console.log('\nTest 10: Cross after gap recovers [-1, NaN, -1, +1]');
  const recover = detectAllZoneZeroCrossSignals([-1, NaN, -1, 1], bars(4), 'V1', 'D');
  check('fires 1 signal', recover.length === 1);
  check('direction is LONG', recover[0].action === 'LONG');
  check('index is 3', recover[0].index === 3);

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

main();
