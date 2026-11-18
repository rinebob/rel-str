/**
 * Verification: selectContractAtCoordinate parity harness (task #1497).
 *
 * The falsifiable convergence proof between live selection and the SA
 * materialized pick corpus: for coordinate C on day T, run
 * `selectContractAtCoordinate` over the AV EOD chain for T — the same
 * corpus SA's picker consumed verbatim — and assert the selected
 * contractId equals `pickDoc[C].days[T].contractId`. Divergence = spec
 * drift to reconcile, never a silent behavior fork.
 *
 * Fixture matrix: several pick-doc cells x sampled days per cell —
 * first/middle/last pick day plus a no_match and no_chain day when the
 * shard carries them (miss-status coverage). One chain fetch per day is
 * shared across all cells — SA passes the stored chain to every cell
 * unchanged (pick-materialize.service.ts: `pickCellsForDate(chain.slice())`).
 *
 * Checks per (cell, day):
 *   pick     → fn returns a contract whose contractId === pick.contractId
 *              (plus dte/expiration/strike/delta equality — deeper drift catches)
 *   no_match → fn returns null
 *   no_chain → informational only: SA had no chain for the day, so there is
 *              no picker output to converge against; a live chain existing
 *              now proves nothing about the corpus then.
 *
 * Run: npx tsx scripts/verify/options-backtest-selection-replay-1497-selection-parity.ts
 * Needs: ADC (or GOOGLE_IMPERSONATE_SERVICE_ACCOUNT) — the same credential
 * path as the deployed partner callables. Pass: all OK. Fail: FAIL lines +
 * exit 1.
 */

import { OptionType, selectContractAtCoordinate } from '@options/common';
import { isPickDocPick } from '@options-replay/contracts';
import type { PickDocCoordinate, PickDocument } from '@options-replay/contracts';
import { fetchPickDoc } from '../../functions/src/options-replay/pick-doc-client';
import { callPartnerHistoricalOptions } from '../../functions/src/options-contract-proxy';
import type { HistoricalOptionContract } from '../../shared/options-contract-contracts';

const SYMBOL = 'QQQ';

/** Fixture cells — distinct types/deltas/DTEs spanning the grid. */
const CELLS: { label: string; coordinate: PickDocCoordinate }[] = [
  {
    label: 'put -0.20Δ @45d (csp-45-20)',
    coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
  },
  {
    label: 'call +0.20Δ @45d (sc-45-20)',
    coordinate: { type: OptionType.CALL, targetDelta: 0.2, expiry: { mode: 'nearestDte', dte: 45 } },
  },
  {
    label: 'put -0.50Δ @180d',
    coordinate: { type: OptionType.PUT, targetDelta: -0.5, expiry: { mode: 'nearestDte', dte: 180 } },
  },
];

let checks = 0;
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function info(msg: string): void {
  console.log(`INFO ${msg}`);
}

/** Sample up to 5 representative days: first/middle/last pick + one of
 *  each miss status the shard actually carries. */
function sampleDays(doc: PickDocument): { pickDays: string[]; missDays: { day: string; status: string }[] } {
  const days = Object.keys(doc.days).sort();
  const picks = days.filter((d) => isPickDocPick(doc.days[d]));
  const misses = days.filter((d) => !isPickDocPick(doc.days[d]));

  const pickDays: string[] = [];
  if (picks.length > 0) {
    pickDays.push(picks[0]);
    if (picks.length > 2) pickDays.push(picks[Math.floor(picks.length / 2)]);
    if (picks.length > 1) pickDays.push(picks[picks.length - 1]);
  }

  const missDays: { day: string; status: string }[] = [];
  for (const status of ['no_match', 'no_chain']) {
    const found = misses.find((d) => (doc.days[d] as { status?: string }).status === status);
    if (found) missDays.push({ day: found, status });
  }
  return { pickDays, missDays };
}

async function main(): Promise<void> {
  // Fetch pick docs for all fixture cells; gather the union of sampled days.
  const cellDocs: { label: string; coordinate: PickDocCoordinate; doc: PickDocument; pickDays: string[]; missDays: { day: string; status: string }[] }[] = [];

  for (const cell of CELLS) {
    const doc = await fetchPickDoc({
      symbol: SYMBOL,
      coordinate: cell.coordinate,
      startDate: '2026-01-01', // corpus coverage starts 2026-01-01
    });
    const sampled = sampleDays(doc);
    cellDocs.push({ ...cell, doc, ...sampled });
    info(`${cell.label}: shard ${doc.firstDate}..${doc.lastDate} — ` +
      `${doc.pickCount} picks / ${doc.missCount} misses; sampled ${sampled.pickDays.length} pick day(s), ${sampled.missDays.length} miss day(s)`);
  }

  const allDays = [...new Set(cellDocs.flatMap((c) => [...c.pickDays, ...c.missDays.map((m) => m.day)]))].sort();

  // One chain fetch per day, shared across cells — mirrors SA's verbatim
  // chain fan-out inside pickCellsForDate.
  const chains = new Map<string, HistoricalOptionContract[]>();
  const chainFailures = new Map<string, string>();
  for (const day of allDays) {
    try {
      const res = await callPartnerHistoricalOptions({ symbol: SYMBOL, date: day });
      // A 200 with ok:false or a non-array payload must NOT become an empty
      // chain — on a no_match day that would vacuously pass (both null).
      if (res?.ok !== true || !Array.isArray(res?.data?.data)) {
        throw new Error(`malformed chain response for ${SYMBOL} @${day} (ok=${res?.ok})`);
      }
      chains.set(day, res.data.data);
    } catch (err) {
      chainFailures.set(day, err instanceof Error ? err.message : String(err));
    }
  }
  info(`fetched chains for ${chains.size} day(s); ${chainFailures.size} fetch failure(s)`);

  // Assert parity per (cell, day).
  for (const cell of cellDocs) {
    for (const day of cell.pickDays) {
      const entry = cell.doc.days[day];
      if (!isPickDocPick(entry)) continue; // defensive — sampled picks only
      const expected = entry.contractId;
      const label = `${cell.label} @${day}`;

      const failure = chainFailures.get(day);
      if (failure !== undefined) {
        check(`${label}: chain fetch`, false, failure);
        continue;
      }
      const chain = chains.get(day)!;
      const coord = {
        type: cell.coordinate.type,
        targetDelta: cell.coordinate.targetDelta,
        dte: cell.coordinate.expiry.dte,
      };
      const sel = selectContractAtCoordinate(day, chain, coord);

      check(`${label}: pick parity`, sel?.contractId === expected,
        sel ? `selected ${sel.contractId}, corpus picked ${expected}` : `no selection, corpus picked ${expected}`);
      if (sel?.contractId === expected) {
        check(`${label}: dte parity`, sel.dte === entry.dte, `sel=${sel.dte} doc=${entry.dte}`);
        check(`${label}: expiration parity`, sel.expiration === entry.expiration,
          `sel=${sel.expiration} doc=${entry.expiration}`);
        check(`${label}: strike parity`, sel.strike === entry.strike, `sel=${sel.strike} doc=${entry.strike}`);
        check(`${label}: delta parity`, sel.delta === entry.delta, `sel=${sel.delta} doc=${entry.delta}`);
      }
    }

    for (const { day, status } of cell.missDays) {
      const label = `${cell.label} @${day}`;
      if (status === 'no_chain') {
        info(`${label}: no_chain — no picker input existed; parity n/a`);
        continue;
      }
      if (status !== 'no_match') {
        info(`${label}: unrecognized miss status '${status}' — not asserted`);
        continue;
      }
      // no_match — the chain existed and nothing was selectable.
      const failure = chainFailures.get(day);
      if (failure !== undefined) {
        info(`${label}: no_match day; chain fetch failed (${failure}) — cannot verify`);
        continue;
      }
      const chain = chains.get(day)!;
      const coord = {
        type: cell.coordinate.type,
        targetDelta: cell.coordinate.targetDelta,
        dte: cell.coordinate.expiry.dte,
      };
      const sel = selectContractAtCoordinate(day, chain, coord);
      check(`${label}: no_match parity`, sel === null,
        sel ? `fn selected ${sel.contractId} but corpus recorded no_match` : 'both null');
    }
  }

  // Guard the silent-pass path: an all-no_chain or empty fixture would
  // otherwise print "0/0 checks passed" and exit 0.
  check('assertions ran', checks > 0, `checks=${checks}`);

  console.log('');
  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('parity harness crashed:', err);
  process.exit(1);
});
