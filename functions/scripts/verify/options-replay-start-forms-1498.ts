/**
 * Verification for #1498 — `optionsReplayStart` two-form request + snapshot.
 *
 * The task rewired the callable's request boundary: exactly one of
 * `variantId` / `legs` / `templateId` resolves to a run's registry identity
 * plus a self-describing `variantSnapshot` stamped on the run doc, so later
 * registry edits can't rewrite history. Two stages:
 *
 *   DRY (default — no writes, no ADC): drives `startReplay` with capturing
 *   fakes against the REAL registries — the same seam as the unit suite,
 *   re-proven end-to-end against shipped data. Asserts all three forms
 *   resolve, the stamped snapshot shapes, leg normalization, and the
 *   rejection matrix (form exclusivity, unknown ids, every SHARED-
 *   validator violation class).
 *
 *   LIVE (--live — needs ADC, writes prod): submits three real runs through
 *   `prodReplayStartDeps` (real Firestore doc + real Cloud Tasks enqueue),
 *   then polls each run doc to a terminal status:
 *     - templateId form  → the deployed worker still completes it
 *       (backward-compat proof — the legacy path is untouched).
 *     - variantId multi-leg + legs forms → the deployed pre-#1499 worker
 *       fails them 'Unknown templateId' — the EXPECTED terminal until the
 *       worker reads variantSnapshot; the run doc still proves the
 *       snapshot persisted through a real write.
 *   A run leaving 'running' is itself evidence the enqueue→dequeue path
 *   worked end-to-end.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/options-replay-start-forms-1498.ts
 *   NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs" \
 *   GOOGLE_CLOUD_PROJECT=rel-str \
 *   npx tsx scripts/verify/options-replay-start-forms-1498.ts --live [--symbol SPY] [--start 2026-11-10]
 *
 * Exit 0 on clean; nonzero on any FAIL.
 */
import { getApp } from 'firebase-admin/app';
import { db } from '../../src/firebase-admin-init';
import { startReplay, prodReplayStartDeps } from '../../src/options-replay/start';
import type {
  ReplayStartDeps,
  OptionsReplayRunWrite,
} from '../../src/options-replay/start';
import { ST_OPTIONS_REPLAY_RUNS_ROOT } from '@st/collections';
import type {
  OptionsReplayPermutationPayload,
  OptionsReplayStartRequest,
  VariantSnapshot,
} from '@options-replay/contracts';
import type { CallableRequest } from 'firebase-functions/v2/https';

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, detail = ''): void => {
  if (cond) {
    pass++;
    console.log(`  ok ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// ==========================
// DRY stage — real registry, fake effects
// ==========================

interface Captured {
  runs: Map<string, OptionsReplayRunWrite>;
  enqueued: OptionsReplayPermutationPayload[];
}

function fakeDeps(): { deps: ReplayStartDeps; captured: Captured } {
  const captured: Captured = { runs: new Map(), enqueued: [] };
  return {
    captured,
    deps: {
      async createRun(runId, doc) {
        captured.runs.set(runId, doc);
      },
      async enqueue(payload) {
        captured.enqueued.push(payload);
      },
      async markRunEnqueueFailed() {
        /* never reached — enqueue fakes succeed */
      },
    },
  };
}

function req(data: unknown): CallableRequest<OptionsReplayStartRequest> {
  return { data, auth: { uid: 'verify-1498' } } as CallableRequest<OptionsReplayStartRequest>;
}

const START = '2026-11-10';
const GOOD_LEG = { kind: 'option', type: 'put', targetDelta: -0.2, dte: 45, side: 'short' };

async function dryStage(): Promise<void> {
  console.log('DRY — resolution + snapshot stamping against the real registry');

  // variantId form — a multi-leg registry variant resolves with stamped legs.
  {
    const { deps, captured } = fakeDeps();
    const resp = await startReplay(
      req({ variantId: 'pcs-45-20-5', symbols: ['SPY'], startDate: START }),
      deps,
    );
    const doc = captured.runs.get(resp.runIds[0]);
    ok(doc?.templateId === 'pcs-45-20-5', 'variantId run templateId = variant id');
    const snap = doc?.variantSnapshot;
    ok(snap?.variantId === 'pcs-45-20-5', 'snapshot.variantId stamped');
    ok(snap?.name === '45DTE 20/5Δ put credit spread', 'snapshot.name from registry');
    ok(snap?.legs.length === 2, 'snapshot.legs = registry legs (2)');
    ok(
      captured.enqueued.length === 1 &&
        Object.keys(captured.enqueued[0]).sort().join(',') === 'runId,symbol',
      'fanout payload stays {runId, symbol}',
    );
  }

  // legs form — inline legs validate, normalize, stamp 'custom'.
  {
    const { deps, captured } = fakeDeps();
    const resp = await startReplay(
      req({
        legs: [
          { ...GOOD_LEG, stray: 'dropped' },
          { kind: 'stock', side: 'long' },
        ],
        symbols: ['QQQ'],
        startDate: START,
      }),
      deps,
    );
    const doc = captured.runs.get(resp.runIds[0]);
    const snap = doc?.variantSnapshot;
    ok(doc?.templateId === 'custom', "legs run templateId = 'custom'");
    ok(snap?.variantId === undefined, 'inline snapshot carries no variantId');
    ok(snap?.name === 'custom 2-leg', 'default name = custom {n}-leg');
    ok(
      JSON.stringify(snap?.legs) ===
        JSON.stringify([
          { kind: 'option', type: 'put', targetDelta: -0.2, dte: 45, side: 'short' },
          { kind: 'stock', side: 'long' },
        ]),
      'stamped legs normalized to contract fields (stray key dropped)',
    );
  }

  // variantName honored.
  {
    const { deps, captured } = fakeDeps();
    const resp = await startReplay(
      req({ legs: [GOOD_LEG], variantName: 'earnings fade', symbols: ['SPY'], startDate: START }),
      deps,
    );
    ok(
      captured.runs.get(resp.runIds[0])?.variantSnapshot?.name === 'earnings fade',
      'variantName stamps the snapshot name',
    );
  }

  // legacy templateId form — resolved to the 1-leg variant snapshot.
  {
    const { deps, captured } = fakeDeps();
    const resp = await startReplay(
      req({ templateId: 'csp-45-20', symbols: ['SPY'], startDate: START }),
      deps,
    );
    const doc = captured.runs.get(resp.runIds[0]);
    const snap = doc?.variantSnapshot;
    ok(doc?.templateId === 'csp-45-20', 'templateId run keeps registry id');
    ok(snap?.variantId === 'csp-45-20', 'legacy snapshot provenance = variant id');
    ok(snap?.legs.length === 1 && snap.legs[0].kind === 'option', 'legacy snapshot = 1 option leg');
  }

  // Rejection matrix — every failure is invalid-argument with no side effects.
  const reject = async (label: string, data: unknown): Promise<void> => {
    const { deps, captured } = fakeDeps();
    const err = await startReplay(req(data), deps).catch((e: unknown) => e);
    const code = (err as { code?: string }).code;
    ok(
      code === 'invalid-argument' && captured.runs.size === 0 && captured.enqueued.length === 0,
      `rejects ${label} — invalid-argument, no side effects`,
      `code=${String(code)}`,
    );
  };
  await reject('no identity form', { symbols: ['SPY'], startDate: START });
  await reject('two identity forms', {
    variantId: 'csp-45-20',
    templateId: 'csp-45-20',
    symbols: ['SPY'],
    startDate: START,
  });
  await reject('all three forms', {
    variantId: 'csp-45-20',
    legs: [GOOD_LEG],
    templateId: 'csp-45-20',
    symbols: ['SPY'],
    startDate: START,
  });
  await reject('unknown variantId', { variantId: 'nope', symbols: ['SPY'], startDate: START });
  await reject('empty legs', { legs: [], symbols: ['SPY'], startDate: START });
  await reject('non-array legs', { legs: 'x', symbols: ['SPY'], startDate: START });
  await reject('off-grid delta', {
    legs: [{ ...GOOD_LEG, targetDelta: -0.22 }],
    symbols: ['SPY'],
    startDate: START,
  });
  await reject('off-menu dte', {
    legs: [{ ...GOOD_LEG, dte: 32 }],
    symbols: ['SPY'],
    startDate: START,
  });
  await reject('put with positive delta', {
    legs: [{ ...GOOD_LEG, targetDelta: 0.2 }],
    symbols: ['SPY'],
    startDate: START,
  });
  await reject('duplicate legs', { legs: [GOOD_LEG, GOOD_LEG], symbols: ['SPY'], startDate: START });
}

// ==========================
// LIVE stage — real prodDeps: Firestore write + Cloud Tasks enqueue
// ==========================

interface LiveCase {
  label: string;
  data: unknown;
  wantTemplateId: string;
  wantSnapshot: (snap: VariantSnapshot | undefined) => boolean;
  /** Expected terminal status under the DEPLOYED (pre-#1499) worker. */
  wantStatus: 'completed' | 'failed';
}

async function liveStage(symbol: string, startDate: string): Promise<void> {
  console.log(`LIVE — submitting real runs via prodReplayStartDeps (${symbol}, ${startDate})`);
  // User ADC can't infer the SA identity Cloud Tasks needs for the OIDC
  // header — pin the deployed function's account (gcloud functions
  // describe optionsReplayStart → serviceConfig.serviceAccountEmail).
  // `app.options` is a defensive deepCopy, so the writable slot is the
  // private options_ it copies from. GOOGLE_CLOUD_PROJECT=rel-str must
  // also be set (project resolution). Verified against firebase-admin
  // v13 — a private-slot rename on upgrade would fail loudly here.
  (getApp() as unknown as { options_: { serviceAccountId?: string } }).options_
    .serviceAccountId = 'rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com';

  const cases: LiveCase[] = [
    {
      label: 'templateId form → completed (legacy worker unchanged)',
      data: { templateId: 'csp-45-20', symbols: [symbol], startDate },
      wantTemplateId: 'csp-45-20',
      wantSnapshot: (s) =>
        s?.variantId === 'csp-45-20' && s.legs.length === 1 && s.legs[0].kind === 'option',
      wantStatus: 'completed',
    },
    {
      label: "variantId multi-leg → failed 'Unknown templateId' until #1499",
      data: { variantId: 'pcs-45-20-5', symbols: [symbol], startDate },
      wantTemplateId: 'pcs-45-20-5',
      wantSnapshot: (s) => s?.variantId === 'pcs-45-20-5' && s.legs.length === 2,
      wantStatus: 'failed',
    },
    {
      label: "legs form → failed 'Unknown templateId 'custom'' until #1499",
      data: {
        legs: [GOOD_LEG, { kind: 'option', type: 'put', targetDelta: -0.05, dte: 45, side: 'long' }],
        variantName: 'verify-1498 pcs',
        symbols: [symbol],
        startDate,
      },
      wantTemplateId: 'custom',
      wantSnapshot: (s) =>
        s?.variantId === undefined && s?.name === 'verify-1498 pcs' && s?.legs.length === 2,
      wantStatus: 'failed',
    },
  ];

  const submitted: Array<{ c: LiveCase; runId: string }> = [];
  for (const c of cases) {
    const resp = await startReplay(req(c.data), prodReplayStartDeps);
    ok(resp.runIds.length === 1, `${c.label}: submitted one run`);
    submitted.push({ c, runId: resp.runIds[0] });
  }

  // Poll each doc to terminal — a run leaving 'running' proves the task
  // dequeued: the real enqueue path worked. Per-case deadline: a slow
  // first case must not starve the rest into spurious timeouts.
  for (const { c, runId } of submitted) {
    const ref = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId);
    const deadline = Date.now() + 180_000;
    let status = 'running';
    let doc: FirebaseFirestore.DocumentData | undefined;
    while (Date.now() < deadline) {
      doc = (await ref.get()).data();
      status = doc?.status ?? 'missing';
      if (status !== 'running' && status !== 'missing') break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    ok(status !== 'running' && status !== 'missing', `${c.label}: reached terminal (${status})`);
    ok(status === c.wantStatus, `${c.label}: terminal = ${c.wantStatus}`, `got ${status} err=${String(doc?.error)}`);
    ok(doc?.templateId === c.wantTemplateId, `${c.label}: templateId persisted`);
    ok(c.wantSnapshot(doc?.variantSnapshot), `${c.label}: variantSnapshot persisted`);
  }
}

// ==========================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const flag = (name: string, dflt: string): string => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
  };
  await dryStage();
  if (live) await liveStage(flag('--symbol', 'SPY'), flag('--start', START));
  console.log(`\n${pass} pass, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

await main();
