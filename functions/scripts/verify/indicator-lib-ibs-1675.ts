/**
 * #1675 — SHARED Task: computeIbs + availability (Thread #1665, Topic #261).
 *
 * Verifies the runtime-verifiable surface of the canonical IBS function:
 *
 *   1. `@st/ibs` BE alias — this file imports the module through the
 *      functions/tsconfig paths mapping; the script running at all proves
 *      the backend can reach `shared/st-ibs.ts` through the alias.
 *   2. Value semantics — IBS = (C-L)/(H-L) on literal bars, boundary and
 *      degenerate-range cases, expected values fixed here by hand.
 *   3. Availability semantics with injected `now` — daily ET-time gate,
 *      weekly weekday gate, 'M' always-defined slot.
 *   4. Real wall-clock check — computeIbs is invoked with NO `ctx`, and
 *      the result is compared against an ET clock read derived
 *      independently inside this script (Intl, not the module's code).
 *      Confirms the function agrees with the real environment it will
 *      actually run under.
 *
 * Pure contract surface: read-only, no env, no Firestore.
 *
 *   npx tsx scripts/verify/indicator-lib-ibs-1675.ts
 */

import { computeIbs, type IbsBar } from '@st/ibs';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`OK   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const BAR = { high: 110, low: 100, close: 108 }; // IBS 0.8

console.log('— value semantics (injected now, past-dated bar) —');
const past = { ...BAR, date: '2026-11-20' };
const pastCtx = { now: new Date('2026-11-23T13:00:00Z') }; // Mon 08:00 ET
check('interior close → 0.8', computeIbs(past, 'D', pastCtx) === 0.8, `${computeIbs(past, 'D', pastCtx)}`);
check('close at high → 1.0', computeIbs({ high: 110, low: 100, close: 110, date: '2026-11-20' }, 'D', pastCtx) === 1);
check('close at low → 0.0', computeIbs({ high: 110, low: 100, close: 100, date: '2026-11-20' }, 'D', pastCtx) === 0);
check('close at midpoint → 0.5', computeIbs({ high: 110, low: 100, close: 105, date: '2026-11-20' }, 'D', pastCtx) === 0.5);
check('zero-range → 0.5', computeIbs({ high: 100, low: 100, close: 100, date: '2026-11-20' }, 'D', pastCtx) === 0.5);
check('inverted range → 0.5', computeIbs({ high: 99, low: 100, close: 99.5, date: '2026-11-20' }, 'D', pastCtx) === 0.5);

console.log('— daily availability (injected now; 17:00Z = 12:00 ET) —');
const todayBar: IbsBar = { ...BAR, date: '2026-11-24' };
check('11:59 ET same-day → undefined', computeIbs(todayBar, 'D', { now: new Date('2026-11-24T16:59:00Z') }) === undefined);
check('12:00 ET same-day → 0.8 (boundary inclusive)', computeIbs(todayBar, 'D', { now: new Date('2026-11-24T17:00:00Z') }) === 0.8);
check('08:00 ET same-day → undefined', computeIbs(todayBar, 'D', { now: new Date('2026-11-24T13:00:00Z') }) === undefined);
check('yesterday-dated bar pre-activation → defined', computeIbs({ ...BAR, date: '2026-11-23' }, 'D', { now: new Date('2026-11-24T13:00:00Z') }) === 0.8);
check(
  'activateAtEtMin override 600 → 10:00 ET defined, 09:59 undefined',
  computeIbs(todayBar, 'D', { now: new Date('2026-11-24T15:00:00Z'), activateAtEtMin: 600 }) === 0.8 &&
    computeIbs(todayBar, 'D', { now: new Date('2026-11-24T14:59:00Z'), activateAtEtMin: 600 }) === undefined,
);

console.log('— weekly availability (injected now; week of Mon 2026-11-23) —');
const weekBar: IbsBar = { ...BAR, date: '2026-11-27' }; // Friday of that ISO week
check('Monday → undefined', computeIbs(weekBar, 'W', { now: new Date('2026-11-23T17:00:00Z') }) === undefined);
check('Tuesday → undefined', computeIbs(weekBar, 'W', { now: new Date('2026-11-24T17:00:00Z') }) === undefined);
check('Wednesday → 0.8 (boundary inclusive)', computeIbs(weekBar, 'W', { now: new Date('2026-11-25T17:00:00Z') }) === 0.8);
check('prior-week bar on Monday → defined', computeIbs({ ...BAR, date: '2026-11-20' }, 'W', { now: new Date('2026-11-23T17:00:00Z') }) === 0.8);
check(
  'activateAtWeekday override 4 → Wed undefined, Thu defined',
  computeIbs(weekBar, 'W', { now: new Date('2026-11-25T17:00:00Z'), activateAtWeekday: 4 }) === undefined &&
    computeIbs(weekBar, 'W', { now: new Date('2026-11-26T17:00:00Z'), activateAtWeekday: 4 }) === 0.8,
);
check(
  'Sunday of the current week → defined (trading-week tail, monotonic gate)',
  computeIbs(weekBar, 'W', { now: new Date('2026-11-29T17:00:00Z') }) === 0.8,
);

console.log('— real wall-clock check (no ctx; expectation derived independently) —');
// Independent ET read — Intl gives the calendar fact; the module's internals
// are not consulted to form the expectation.
const et = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
}).formatToParts(new Date());
const get = (t: string) => et.find((p) => p.type === t)?.value ?? '';
const etDate = `${get('year')}-${get('month')}-${get('day')}`;
const etMin = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
const etWd = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[get('weekday')] ?? 0;
console.log(`  now ET: ${etDate} ${get('weekday')} ${Math.floor(etMin / 60)}:${String(etMin % 60).padStart(2, '0')} (min ${etMin}, weekday ${etWd})`);

const realToday: IbsBar = { ...BAR, date: etDate };
const realD = computeIbs(realToday, 'D');
check(
  `today-dated D bar at real ET ${Math.floor(etMin / 60)}:${String(etMin % 60).padStart(2, '0')} → ${etMin < 720 ? 'undefined' : '0.8'}`,
  etMin < 720 ? realD === undefined : realD === 0.8,
  `got ${realD}`,
);
const realW = computeIbs(realToday, 'W');
check(
  `this-week W bar on real weekday ${etWd} → ${etWd < 3 ? 'undefined' : '0.8'}`,
  etWd < 3 ? realW === undefined : realW === 0.8,
  `got ${realW}`,
);
check('past-dated D bar always defined at real wall clock', computeIbs({ ...BAR, date: '2026-11-20' }, 'D') === 0.8);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
