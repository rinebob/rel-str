/**
 * Verify — #1499 Position-row mapper + permutation worker.
 *
 * DRY stage (default, no credentials): drives `runReplayPermutation`
 * with `ReplayPermutationDeps` fakes through the REAL mapper, validator,
 * and coordinate derivation — multi-leg join, stock legs, snapshot
 * guards, per-leg fetch fanout, v2 doc shape, failure naming.
 *
 * LIVE stage (`--live`, needs ADC + GOOGLE_CLOUD_PROJECT=rel-str +
 * IPv4 preload): writes REAL run docs to st-options-replay-runs and
 * invokes `runReplayPermutation` with `prodReplayPermutationDeps` —
 * real SA pick-doc fetches + real Firestore list-doc writes + real
 * run close-out. The Cloud Tasks hop is proven by #1498's verify;
 * this stage verifies the worker's data path end-to-end.
 *
 * Live runs left in place as evidence (verify-1499-* ids are
 * greppable; the retry callable can re-drive them).
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getReplayVariant, validateVariantLegs } from '@options-replay/templates';
import {
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  ST_OPTIONS_REPLAY_RUNS_ROOT,
  stOptionsContractListDocId,
} from '@st/collections';
import type {
  ContractListRow,
  OptionsContractListDoc,
  OptionLeg,
  PickDocCoordinate,
  PickDocument,
  VariantLeg,
} from '@options-replay/contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import {
  runReplayPermutation,
  prodReplayPermutationDeps,
} from '../../src/options-replay/permutation';
import type { ReplayPermutationDeps } from '../../src/options-replay/permutation';

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
// DRY — fake deps through the real worker core
// ==========================

const SHORT_PUT: OptionLeg = { kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45, side: TradeSide.SHORT };
const LONG_PUT: OptionLeg = { kind: 'option', type: OptionType.PUT, targetDelta: -0.05, dte: 45, side: TradeSide.LONG };
const STOCK: VariantLeg = { kind: 'stock', side: TradeSide.LONG };

function fakeDoc(coordinate: PickDocCoordinate, days: PickDocument['days']): PickDocument {
  return {
    type: coordinate.type,
    targetDelta: coordinate.targetDelta,
    expiry: coordinate.expiry,
    symbol: 'SPY',
    gridVersion: 2,
    firstDate: '2026-11-02',
    lastDate: '2026-11-06',
    pickCount: Object.values(days).filter((d) => 'contractId' in d).length,
    missCount: 0,
    days,
  };
}

const DAY = {
  underlyingClose: 580, contractId: 'SPY260220P00580000', expiration: '2026-02-20',
  dte: 45, strike: 580, delta: -0.2, iv: 0.22, mark: 9.5, bid: 9.4, ask: 9.6,
  volume: 100, openInterest: 5000,
};

interface FakeEnv {
  deps: ReplayPermutationDeps;
  writes: { docId: string; fields: Record<string, unknown> }[];
  fetches: { coordinate: unknown }[];
  closeOuts: { outcome: string; error?: string }[];
}

function fakeEnv(opts: {
  legs: VariantLeg[];
  docs?: Record<string, PickDocument>;
  fetchError?: (coordinate: { targetDelta: number }) => Error | undefined;
  noSnapshot?: boolean;
}): FakeEnv {
  const writes: FakeEnv['writes'] = [];
  const fetches: FakeEnv['fetches'] = [];
  const closeOuts: FakeEnv['closeOuts'] = [];
  const docs = opts.docs ?? {};
  const deps: ReplayPermutationDeps = {
    getRun: async () => ({
      symbol: 'SPY',
      templateId: 'verify',
      startDate: '2026-11-02',
      ...(opts.noSnapshot ? {} : { variantSnapshot: { name: 'v', legs: opts.legs } }),
    }),
    getListDoc: async () => undefined,
    writeListDoc: async (docId, fields) => { writes.push({ docId, fields: fields as Record<string, unknown> }); },
    loadTradingDays: async () => ['2026-11-02', '2026-11-03', '2026-11-04'],
    fetchPickDoc: async (input) => {
      fetches.push({ coordinate: input.coordinate });
      const err = opts.fetchError?.(input.coordinate);
      if (err) throw err;
      const key = `${input.coordinate.targetDelta}`;
      return docs[key] ?? fakeDoc(input.coordinate, { '2026-11-02': DAY, '2026-11-03': DAY });
    },
    closeOutRun: async (_runId, outcome, error) => { closeOuts.push({ outcome, error }); },
  };
  return { deps, writes, fetches, closeOuts };
}

async function dry(): Promise<void> {
  console.log('DRY — worker core with fake deps through the real mapper');

  // S1 — two-leg join: one fetch per option leg, atomic position rows
  {
    const env = fakeEnv({
      legs: [SHORT_PUT, LONG_PUT],
      docs: { '-0.2': fakeDoc({ type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } }, { '2026-11-02': DAY, '2026-11-03': DAY }) },
    });
    await runReplayPermutation({ runId: 'r1', symbol: 'SPY' }, env.deps, true);
    ok('one fetch per option leg (2)', env.fetches.length === 2);
    const final = env.writes.at(-1)?.fields;
    ok('schemaVersion 2 stamped', final?.schemaVersion === 2);
    ok('legMetas ordered per option leg', Array.isArray(final?.legMetas) && final.legMetas.length === 2);
    const rows = final?.rows as ContractListRow[];
    const pos = rows?.[0];
    ok('position row carries 2 legs', pos?.kind === 'position' && pos.legs.length === 2);
    if (pos?.kind === 'position') {
      ok('legs in declared order + sides', pos.legs[0].kind === 'option' && (pos.legs[0] as { side: string }).side === 'short' && (pos.legs[1] as { side: string }).side === 'long');
    }
    ok('success close-out', env.closeOuts[0]?.outcome === 'success');
  }

  // S2 — leg 1 misses day 1 → no-selection with legMisses
  {
    const env = fakeEnv({
      legs: [SHORT_PUT, LONG_PUT],
      docs: { '-0.05': fakeDoc({ type: OptionType.PUT, targetDelta: -0.05, expiry: { mode: 'nearestDte', dte: 45 } }, { '2026-11-02': { status: 'no_match' } }) },
    });
    await runReplayPermutation({ runId: 'r2', symbol: 'SPY' }, env.deps, true);
    const row = (env.writes.at(-1)?.fields.rows as ContractListRow[])[0];
    ok('miss → no-selection with legMisses[legIndex 1]', row?.kind === 'no-selection' && row.legMisses[0].legIndex === 1 && row.legMisses[0].reason === 'miss');
  }

  // S3 — stock leg: no fetch, resolves off the pick's underlyingClose
  {
    const env = fakeEnv({ legs: [STOCK, SHORT_PUT] });
    await runReplayPermutation({ runId: 'r3', symbol: 'SPY' }, env.deps, true);
    ok('stock leg → zero extra fetch', env.fetches.length === 1);
    const row = (env.writes.at(-1)?.fields.rows as ContractListRow[])[0];
    ok('position legs keep declared order (stock first)', row?.kind === 'position' && row.legs[0].kind === 'stock' && row.legs[1].kind === 'option');
    if (row?.kind === 'position' && row.legs[0].kind === 'stock') {
      ok('stock underlyingClose from pick', row.legs[0].underlyingClose === 580);
    }
  }

  // S4 — snapshot guards: missing / malformed / stock-only
  {
    const missing = fakeEnv({ legs: [], noSnapshot: true });
    await runReplayPermutation({ runId: 'r4', symbol: 'SPY' }, missing.deps, false);
    ok('missing snapshot → failed, no fetches', missing.fetches.length === 0 && missing.writes.some((w) => w.fields.status === 'failed'));

    const malformed = fakeEnv({
      legs: [{ kind: 'option', type: 'put', targetDelta: -0.21, dte: 45, side: 'short' } as VariantLeg],
    });
    await runReplayPermutation({ runId: 'r5', symbol: 'SPY' }, malformed.deps, false);
    const failedWrite = malformed.writes.find((w) => w.fields.status === 'failed');
    ok('malformed legs → failed naming leg errors', !!failedWrite && /leg 0/.test(String(failedWrite.fields.error)));

    const stockOnly = fakeEnv({ legs: [STOCK] });
    await runReplayPermutation({ runId: 'r6', symbol: 'SPY' }, stockOnly.deps, false);
    const stockFail = stockOnly.writes.find((w) => w.fields.status === 'failed');
    ok('stock-only → failed (nothing to select)', !!stockFail && /option leg/.test(String(stockFail.fields.error)));
  }

  // S5 — leg fetch failure names the leg + coordinate
  {
    const { PartnerHttpError } = await import('../../src/partner-infrastructure');
    const env = fakeEnv({
      legs: [SHORT_PUT, LONG_PUT],
      fetchError: (c) => (c.targetDelta === -0.05 ? new PartnerHttpError('no shard', 404, 'NOT_FOUND') : undefined),
    });
    await runReplayPermutation({ runId: 'r7', symbol: 'SPY' }, env.deps, false);
    const failedWrite = env.writes.find((w) => w.fields.status === 'failed');
    ok('coded 404 → failed naming failing leg', !!failedWrite && /leg 1/.test(String(failedWrite.fields.error)));
    ok('both fetches still attempted (bounded parallel)', env.fetches.length === 2);
  }
}

// ==========================
// LIVE — real prodDeps end-to-end
// ==========================

interface LiveCase {
  label: string;
  legs: VariantLeg[];
  templateId: string;
  /** 'success' is strict; 'either' accepts a designed permanent failure
   *  (corpus may lack a cell — a failed doc naming the leg still proves
   *  the pipeline). A failure under 'either' must still match
   *  `failurePattern` — loose acceptance would hide real regressions
   *  (e.g. a wrong wire coordinate 404ing every leg). */
  expect: 'success' | 'either';
  /** Required shape of a designed failure (default: the leg-annotated
   *  pick-doc failure the worker produces). */
  failurePattern?: RegExp;
  noSnapshot?: boolean;
  assertDoc?: (doc: OptionsContractListDoc) => [string, boolean][];
}

async function live(): Promise<void> {
  console.log('LIVE — real run docs + prodReplayPermutationDeps (real SA fetch + Firestore)');
  // The prod-deps import (firebase-admin-init) already initialized the
  // default app — reuse it.
  const db = getFirestore();
  const runCol = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT);
  const listCol = db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT);

  const variant = getReplayVariant('pcs-45-20-5');
  const cov = getReplayVariant('cov-45-20');
  ok('registry fixtures resolve (pcs-45-20-5, cov-45-20)', !!variant && !!cov);
  if (!variant || !cov) return;

  const cases: LiveCase[] = [
    {
      label: 'legacy csp-45-20 snapshot → v2 1-leg doc',
      templateId: 'csp-45-20',
      legs: [getReplayVariant('csp-45-20')!.legs[0]],
      expect: 'success',
      assertDoc: (d) => [
        ['schemaVersion 2', d.schemaVersion === 2],
        ['legMetas[1]', d.legMetas.length === 1],
        ['rows non-empty', d.rows.length > 0],
        ['position row legs[1]', d.rows.some((r) => r.kind === 'position' && r.legs.length === 1)],
      ],
    },
    {
      label: 'pcs-45-20-5 multi-leg → atomic 2-leg rows',
      templateId: 'pcs-45-20-5',
      legs: variant.legs as VariantLeg[],
      expect: 'either',
      assertDoc: (d) => [
        ['legMetas[2]', d.legMetas.length === 2],
        ['position legs[2] or no-selection', d.rows.every((r) => (r.kind === 'position' ? r.legs.length === 2 : r.legMisses.length >= 1))],
        ['at least one position row', d.rows.some((r) => r.kind === 'position')],
      ],
    },
    {
      label: 'cov-45-20 stock leg → stock resolves off underlyingClose',
      templateId: 'cov-45-20',
      legs: cov.legs as VariantLeg[],
      expect: 'either',
      assertDoc: (d) => [
        ['some position row carries a stock leg', d.rows.some((r) => r.kind === 'position' && r.legs.some((l) => l.kind === 'stock'))],
        ['stock leg carries underlyingClose', d.rows.some((r) => r.kind === 'position' && r.legs.some((l) => l.kind === 'stock' && typeof l.underlyingClose === 'number' && l.underlyingClose > 0))],
      ],
    },
    {
      label: 'inline custom legs → succeeds off snapshot (the #1498-deferred path)',
      templateId: 'custom',
      legs: [SHORT_PUT, { kind: 'option', type: OptionType.PUT, targetDelta: -0.05, dte: 45, side: TradeSide.LONG }],
      expect: 'either',
      assertDoc: (d) => [
        ['templateId persisted as custom', d.templateId === 'custom'],
        ['legMetas[2]', d.legMetas.length === 2],
      ],
    },
    {
      label: 'missing variantSnapshot → permanent failure (pre-model run)',
      templateId: 'csp-45-20',
      legs: [getReplayVariant('csp-45-20')!.legs[0]],
      expect: 'either',
      failurePattern: /missing\/malformed variantSnapshot/,
      noSnapshot: true,
    },
  ];

  for (const c of cases) {
    const runId = `verify-1499-${Date.now()}-${c.label.replace(/\W+/g, '-').slice(0, 24)}`;
    const errs = validateVariantLegs(c.legs, 'case');
    if (errs.length) {
      ok(`${c.label}: fixture legs valid`, false, errs.join('; '));
      continue;
    }
    // Real run doc — same shape startReplay stamps (#1498).
    await runCol.doc(runId).set({
      runId,
      templateId: c.templateId,
      symbol: 'SPY',
      startDate: '2026-11-02',
      status: 'running',
      ...(c.noSnapshot ? {} : { variantSnapshot: { ...(c.templateId === 'custom' ? {} : { variantId: c.templateId }), name: `verify ${c.templateId}`, legs: c.legs } }),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await runReplayPermutation({ runId, symbol: 'SPY' }, prodReplayPermutationDeps, true);
    const doc = (await listCol.doc(stOptionsContractListDocId(runId)).get()).data() as OptionsContractListDoc | undefined;
    const run = (await runCol.doc(runId).get()).data();
    ok(`${c.label}: list doc written`, !!doc);
    if (!doc) continue;
    const expectFailed = c.expect === 'either';
    const terminalOk = c.expect === 'success'
      ? doc.status === 'success'
      : doc.status === 'success' ||
        (doc.status === 'failed' &&
          (c.failurePattern ?? /leg \d+ pick doc \(/).test(doc.error ?? ''));
    ok(`${c.label}: terminal status (${doc.status})`, terminalOk, doc.error ?? '');
    const expectedRun = doc.status === 'success' ? 'completed' : 'failed';
    ok(`${c.label}: run closed out ${expectedRun}`, run?.status === expectedRun);
    if (expectFailed && doc.status === 'failed') {
      console.log(`    (designed failure evidence: ${doc.error})`);
      continue; // failure IS the evidence — doc-shape asserts apply to success docs
    }
    for (const [name, cond] of c.assertDoc?.(doc) ?? []) {
      ok(`${c.label}: ${name}`, cond);
    }
  }
}

// ==========================

dry()
  .then(() => (LIVE ? live() : Promise.resolve()))
  .then(() => {
    console.log(`\n${passed} pass, ${failed} FAIL`);
    process.exit(failed ? 1 : 0);
  })
  .catch((e) => {
    console.error('verify crashed:', e);
    process.exit(1);
  });
