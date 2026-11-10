/**
 * Live probe for #1401 — verifies pick-doc 404 semantics against the REAL
 * SA endpoint (partnerOptionsDeltaPicksV1). The #1401 bug: any 404 that
 * wasn't OPTIONS_NOT_ENABLED was skipped as a "coverage gap", so a
 * Google-infra 404 (endpoint missing, wrong URL, pre-deploy window) was
 * mislabeled `no year shard found` — a transport/config failure presented
 * as a data-availability failure.
 *
 * Legs:
 *   A  happy path — real QQQ put -0.20 45-DTE pick doc, window
 *      2026-01-05→2026-03-31 → returns a PickDocument with days.
 *   B  shard-gap skip — same coordinate, window 2015-01-05→2026-03-31:
 *      every pre-2026 year has no shard → each 404+NOT_FOUND is skipped,
 *      the 2026 shard merges → doc returns with only 2026 days. If SA's
 *      shard-miss code were anything other than exactly 'NOT_FOUND',
 *      this leg throws — it's the regression leg for the narrowed skip.
 *   C  infra-404 propagation — re-execs this script with
 *      PARTNER_PICK_DOC_URL pointed at a nonexistent path on the real
 *      partner host → a genuine Google infra 404 (no partnerCode).
 *      fetchPickDoc must REJECT with that error — never the
 *      'no year shard found' wrapper. This is the #1401 regression leg.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/pick-doc-404-semantics-1401.ts
 *
 * Env: needs ADC able to mint an ID token for the partner caller SA —
 * GOOGLE_IMPERSONATE_SERVICE_ACCOUNT or user ADC with Token Creator on
 * rel-str-partner-caller-prod (same setup as every partner verify).
 * Read-only — GETs only, never writes. Exit 0 = all legs PASS.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OptionType } from '@options/common';
import { PartnerHttpError, PARTNER_AUDIENCE } from '../../src/partner-infrastructure';
import type { PickDocCoordinate } from '@options-replay/contracts';

const BOGUS_PATH = 'qaNoSuchEndpoint1401';
const PUT_45_20: PickDocCoordinate = {
  type: OptionType.PUT,
  targetDelta: -0.2,
  expiry: { mode: 'nearestDte', dte: 45 },
};
const WINDOW_2026 = { startDate: '2026-01-05', endDate: '2026-03-31' };

// ── Leg C child: runs with the bogus endpoint URL ──────────────────────────
// PARTNER_PICK_DOC_URL is read at module load, so it must be set before the
// import — hence the re-exec rather than toggling env in-process.
if (process.env.PARTNER_PICK_DOC_URL?.includes(BOGUS_PATH)) {
  const { fetchPickDoc } = await import('../../src/options-replay/pick-doc-client');
  try {
    await fetchPickDoc({ symbol: 'QQQ', coordinate: PUT_45_20, ...WINDOW_2026 });
    console.error('infra-404 child: fetchPickDoc RESOLVED — expected rejection');
    process.exit(3);
  } catch (e) {
    const ok =
      e instanceof PartnerHttpError &&
      e.status === 404 &&
      e.partnerCode === undefined &&
      !/no year shard found/.test(e.message);
    if (ok) {
      console.error(`infra-404 child: propagated as expected — ${e.message.slice(0, 120)}`);
      process.exit(0);
    }
    console.error(
      `infra-404 child: WRONG shape — ${e instanceof PartnerHttpError ? `${e.status} ${e.message.slice(0, 160)}` : e}`,
    );
    process.exit(4);
  }
}

// ── Parent: legs A + B, then spawn leg C ───────────────────────────────────
const { fetchPickDoc } = await import('../../src/options-replay/pick-doc-client');

const results: { leg: string; pass: boolean; detail: string }[] = [];
const record = (leg: string, pass: boolean, detail: string) => {
  results.push({ leg, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${leg} — ${detail}`);
};

// A — happy path
try {
  const doc = await fetchPickDoc({ symbol: 'QQQ', coordinate: PUT_45_20, ...WINDOW_2026 });
  const days = Object.keys(doc.days);
  record(
    'A happy-path fetch',
    days.length > 0,
    `doc returned, ${days.length} days (${doc.firstDate}→${doc.lastDate})`,
  );
} catch (e) {
  record('A happy-path fetch', false, `threw: ${e instanceof Error ? e.message : e}`);
}

// B — NOT_FOUND shard-gap skip: pre-coverage years must be skipped, 2026 merged
try {
  const doc = await fetchPickDoc({
    symbol: 'QQQ',
    coordinate: PUT_45_20,
    startDate: '2015-01-05',
    endDate: '2026-03-31',
  });
  const days = Object.keys(doc.days);
  const preCoverage = days.filter((d) => d < '2026-01-01');
  record(
    'B shard-gap skip (NOT_FOUND)',
    days.length > 0 && preCoverage.length === 0,
    // A failure here can also mean SA backfilled pre-2026 shards (days
    // <2026-01-01 are then legitimate data, not a regression) — check
    // the skip logs before diagnosing.
    `doc returned ${days.length} days, all ≥2026-01-01; 2015–2025 shards skipped as NOT_FOUND gaps`,
  );
} catch (e) {
  record(
    'B shard-gap skip (NOT_FOUND)',
    false,
    `threw instead of skipping: ${e instanceof PartnerHttpError ? `${e.status} ${e.message.slice(0, 140)}` : e}`,
  );
}

// C — infra-404 propagation via bogus endpoint on the real host
const bogusUrl = `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${BOGUS_PATH}`;
try {
  execFileSync(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(import.meta.url)],
    {
      env: { ...process.env, PARTNER_PICK_DOC_URL: bogusUrl },
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  record('C infra-404 propagates', true, 'bare infra 404 surfaced as a fetch failure — never the shard-gap wrapper');
} catch (err: unknown) {
  const e = err as { status?: number; stderr?: Buffer; stdout?: Buffer };
  const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
  record(
    'C infra-404 propagates',
    false,
    `child exit ${e.status ?? '?'}: ${out.split('\n').pop() ?? 'no output'}`,
  );
}

const failed = results.filter((r) => !r.pass);
console.log(
  failed.length === 0 ? '\n=== ALL PASS ===' : `\n=== ${failed.length} FAIL ===`,
);
process.exit(failed.length === 0 ? 0 : 1);
