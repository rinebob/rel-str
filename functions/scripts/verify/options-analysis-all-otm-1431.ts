/**
 * Result-doc probe for #1431 bug 3 — verifies the expired-fields
 * (ITM/OTM) math against live `st-options-analysis-results` docs:
 *
 *   Leg A — internal consistency: every 'expired' record must satisfy
 *     expiredItm === (intrinsicAtExpiry > 0)
 *   (intrinsic is max(±(close−strike), 0), so ITM iff intrinsic > 0).
 *
 *   Leg B — all-OTM census: counts expired records per doc and reports
 *     the ITM/OTM split. An all-OTM set is legal (a 20Δ CSP run SHOULD
 *     mostly expire worthless) but is flagged for eyeball when every
 *     doc is 100% OTM — that's the UAT suspicion.
 *
 *   Leg C — near-the-money spot check: the expired record with the
 *     smallest assignmentDistancePct gets its ITM/OTM recomputed from
 *     the SAME underlying-close source the worker used
 *     (`getCachedBarsFromSymbolData` at the OCC-parsed expiration) —
 *     a recompute that disagrees is a FAIL.
 *
 *   FAIL (exit 1):
 *   - any expired record violating the intrinsic↔ITM invariant
 *   - the spot-check recompute disagreeing with the stored flag
 *   - the spot-check contract's expiry missing from the underlying map
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/options-analysis-all-otm-1431.ts [--run <listDocId>]
 *
 * Read-only — never writes. Needs ADC. Exit 0 on clean audit.
 */
import { db } from '../../src/firebase-admin-init';
import { getCachedBarsFromSymbolData } from '../../src/st-cloud-function/data-loader';
import { ST_OPTIONS_ANALYSIS_RESULTS_ROOT } from '@st/collections';
import { parseOccContractId } from '@options-contract/contracts';
import type {
  AnalysisExpiredTrade,
  AnalysisResultDoc,
} from '@options-analysis/contracts';

interface Finding {
  tier: 'FAIL' | 'WARN' | 'INFO';
  docId: string;
  detail: string;
}

const findings: Finding[] = [];
const add = (tier: Finding['tier'], docId: string, detail: string) =>
  findings.push({ tier, docId, detail });

const argRun = (() => {
  const i = process.argv.indexOf('--run');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

interface SpotCandidate {
  docId: string;
  symbol: string;
  rec: AnalysisExpiredTrade;
  distancePct: number;
}

async function main(): Promise<void> {
  const snap = argRun
    ? await db
        .collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT)
        .where('contractListDocId', '==', argRun)
        .get()
    : await db.collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT).get();
  console.log(
    `st-options-analysis-results: ${snap.size} doc(s)${argRun ? ` (--run ${argRun})` : ''}`,
  );
  if (snap.size === 0) {
    console.log('EMPTY — nothing to audit');
    return;
  }

  let expiredTotal = 0;
  let itmTotal = 0;
  let spot: SpotCandidate | null = null;

  for (const docSnap of snap.docs) {
    const d = docSnap.data() as AnalysisResultDoc;
    if (d.status !== 'success' || !Array.isArray(d.trades)) continue;

    let docExpired = 0;
    let docItm = 0;
    for (const t of d.trades) {
      if (t.outcome !== 'expired') continue;
      docExpired++;
      expiredTotal++;
      const intrinsic = t.intrinsicAtExpiry;
      // Leg A — the flag must agree with the intrinsic it was derived from.
      if (t.expiredItm !== (intrinsic > 0)) {
        add(
          'FAIL',
          docSnap.id,
          `${t.contractId}: expiredItm=${t.expiredItm} but intrinsicAtExpiry=${intrinsic}`,
        );
      }
      if (t.expiredItm) docItm++, itmTotal++;
      if (!spot || t.assignmentDistancePct < spot.distancePct) {
        spot = { docId: docSnap.id, symbol: d.symbol, rec: t, distancePct: t.assignmentDistancePct };
      }
    }
    if (docExpired > 0 && docItm === 0) {
      add(
        'INFO',
        docSnap.id,
        `all-OTM: ${docExpired}/${docExpired} expired records OTM (legal for 20Δ CSP — verify spot check)`,
      );
    } else if (docExpired > 0) {
      add('INFO', docSnap.id, `${docItm} ITM / ${docExpired - docItm} OTM of ${docExpired} expired`);
    }
  }

  console.log(
    `expired census: ${expiredTotal} record(s) — ${itmTotal} ITM / ${expiredTotal - itmTotal} OTM`,
  );

  // Leg C — nearest-the-money recompute against the worker's own data source.
  if (spot) {
    const parsed = parseOccContractId(spot.rec.contractId);
    if (!parsed) {
      add('FAIL', spot.docId, `spot-check contractId '${spot.rec.contractId}' unparseable`);
    } else {
      const { dailyBars } = await getCachedBarsFromSymbolData(spot.symbol, parsed.expiration);
      const close = new Map(dailyBars.map((b) => [b.d, b.c])).get(parsed.expiration);
      if (close === undefined) {
        add(
          'FAIL',
          spot.docId,
          `no underlying close at ${parsed.expiration} for ${spot.symbol} — stored flag unverifiable`,
        );
      } else {
        const recomputedItm =
          parsed.optionType === 'put' ? close < parsed.strike : close > parsed.strike;
        const recomputedIntrinsic =
          parsed.optionType === 'put'
            ? Math.max(parsed.strike - close, 0)
            : Math.max(close - parsed.strike, 0);
        console.log(
          `spot check: ${spot.rec.contractId} (${spot.docId}) — expiry ${parsed.expiration}, ` +
            `strike ${parsed.strike}, underlying close ${close}, distance ${spot.distancePct.toFixed(2)}% — ` +
            `stored expiredItm=${spot.rec.expiredItm} intrinsic=${spot.rec.intrinsicAtExpiry} | ` +
            `recomputed itm=${recomputedItm} intrinsic=${recomputedIntrinsic.toFixed(4)}`,
        );
        if (recomputedItm !== spot.rec.expiredItm) {
          add(
            'FAIL',
            spot.docId,
            `spot-check recompute disagrees: stored expiredItm=${spot.rec.expiredItm}, recomputed ${recomputedItm} (close ${close} vs strike ${parsed.strike})`,
          );
        }
        if (Math.abs(recomputedIntrinsic - spot.rec.intrinsicAtExpiry) > 0.01) {
          add(
            'FAIL',
            spot.docId,
            `spot-check intrinsic disagrees: stored ${spot.rec.intrinsicAtExpiry}, recomputed ${recomputedIntrinsic.toFixed(4)}`,
          );
        }
      }
    }
  } else {
    console.log('no expired records — spot check skipped');
  }

  const fails = findings.filter((f) => f.tier === 'FAIL');
  for (const f of findings) {
    console.log(`${f.tier} ${f.docId}: ${f.detail}`);
  }
  console.log(`\n${fails.length} FAIL / ${findings.length - fails.length} INFO+WARN`);
  if (fails.length > 0) {
    process.exitCode = 1;
  } else {
    console.log('PROBE PASS');
  }
}

main().catch((err) => {
  console.error(`probe crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
