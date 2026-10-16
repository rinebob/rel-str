/**
 * Manually dispatch a consumer payload to the deployed
 * `sdsConsumerDispatch` task queue (#983 QA — replays the nightly
 * settlement chain, incl. the signal EOD close stamp, without waiting
 * for the next natural SDS completion).
 *
 * Consumers: 'settlement' | 'selection' | 'st-nightly' | 'st-intraday'
 * (see sds-consumer-dispatch.ts). 'settlement' →
 * runSettlementForAllInstances — EOD stamp → eval → signal settlement →
 * per-instance settlement/held-shares → stats. Idempotent by design.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/sds-consumer-dispatch.ts \
 *     [consumer] [marketDate]
 *
 * Defaults: 'settlement', today's PT date.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFunctions } from 'firebase-admin/functions';

initializeApp({
  credential: applicationDefault(),
  projectId: 'rel-str',
  // Task OIDC audience — see sdsConsumerDispatch serviceConfig.
  serviceAccountId:
    'rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com',
});

const [, , consumerArg, marketDateArg] = process.argv;

const payload = {
  consumer: consumerArg ?? 'settlement',
  marketDate:
    marketDateArg ??
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }),
};

console.log('enqueueing sdsConsumerDispatch:', payload);
await getFunctions().taskQueue('sdsConsumerDispatch').enqueue(payload);
console.log('enqueued — watch `sds_consumer_dispatch_*` + OptionsStrategyPasses logs');
