# RSH Data-Ready Pub/Sub — Partner Integration Guide (SavantAPI)

RSH (Relative Strength Heatmap) is our Firebase/Cloud Run–backed application that computes and serves Relative Strength (RS) metrics and related signals to an Angular frontend. In this integration, SavantAPI acts as the upstream data provider for OHLCV and related datasets. When SavantAPI completes a scheduled load (e.g., pre-close or post-close), it notifies RSH via this Pub/Sub topic so RSH can begin RS computation and downstream processing without polling.

This guide explains how SavantAPI should notify the RSH backend when a scheduled data load completes. The Pub/Sub topic is server-to-server and secured with Google IAM.

Related spec: `docs/partner/savantapi-data-ready-webhook.md` (payload fields, validation rules, and processing contract).

## At a glance (Prod)

- Pub/Sub topic: **partner-data-ready** (consumer‑agnostic channel for all partners)
- Allowlisted service account(s): TBD – SavantAPI to provide SA email(s) to be allowlisted per environment

## Pub/Sub Topic

All Data‑Ready events are published to the **partner-data-ready** Pub/Sub topic. Consumers (including RSH) should create a subscription to this topic and pull messages.

Message semantics:
* Each message contains the JSON payload described in the "Payload Schema (v1)" section.
* Pub/Sub provides at‑least‑once delivery; the `runId` field is idempotent.
* Consumers should acknowledge messages after successful processing. On failure, do not ack so the message can be redelivered (or use dead‑letter handling).

## Authentication / Authorization (Pub/Sub IAM)

* The publisher (SavantAPI) must have the `roles/pubsub.publisher` role on the **partner-data-ready** topic.
* The consumer (RSH) must have the `roles/pubsub.subscriber` role on the subscription it creates, and optionally `roles/pubsub.viewer` to list the topic.
* No OIDC ID token is required for Pub/Sub delivery; IAM permissions control access.

IAM on RSH side:
* RSH creates a subscription (e.g., `rsh-partner-data-ready`) on the topic.
* Grant the partner service account the `roles/pubsub.subscriber` role on that subscription.

## Payload Schema (v1)

See `docs/partner/savantapi-data-ready-webhook.md` for full definitions. Minimal v1:

```json
{
  "version": "v1",
  "runId": "2025-09-11-post",
  "phase": "post",
  "intervals": ["DAILY"],
  "time": 1736726400000,
  "baselinesUpdatedCount": 20,
  "symbolsUpdatedCount": 500,
  "universeVersion": "us-eq-2025-09-11"
}
```

Recommended additional fields (optional in v1): `marketDate`, `tz`, `durationMs`, `phaseWindow`, `datasetManifest`, `env`, `traceId`.

## Idempotency & Retries

- Idempotency key: `runId`. Re-sending the same `runId` is safe; RSH deduplicates.
- Retry policy: on `5xx` only. Use exponential backoff (e.g., a few attempts over ~10–15 minutes).
- Do not retry on `4xx` (fix the request).

## Pub/Sub Subscription Example (gcloud)

Replace placeholder:
* `<SA_EMAIL>` – the service account email that will **pull** messages (RSH’s service account).

### Create a pull subscription

```bash
# Create a subscription named rsh-partner-data-ready on the partner-data-ready topic
gcloud pubsub subscriptions create rsh-partner-data-ready \
  --topic=partner-data-ready \
  --ack-deadline=60

# Grant the RSH service account permission to pull from this subscription
gcloud pubsub subscriptions add-iam-policy-binding rsh-partner-data-ready \
  --member=serviceAccount:<SA_EMAIL> \
  --role=roles/pubsub.subscriber
```

### Pull messages (Node.js example)

```ts
import { PubSub } from '@google-cloud/pubsub';

const pubsub = new PubSub();
const subscription = pubsub.subscription('rsh-partner-data-ready');

subscription.on('message', message => {
  const payload = JSON.parse(message.data.toString());
  console.log('Received Data‑Ready event:', payload);
  // TODO: Process the payload (e.g., start RS computation)
  message.ack();
});

subscription.on('error', err => {
  console.error('Subscription error:', err);
});
```

## Symbol-Added Notifications

In addition to the scheduled `partner-data-ready` broadcasts, SavantAPI publishes a `partner-symbol-added` message whenever a new symbol's full D/W/M history is available.

- **Pub/Sub topic**: `partner-symbol-added`
- **Consumer**: `functions/src/symbol-data-sync/symbol-data-symbol-added.ts`
- **Purpose**: Backfill the new symbol into `symbol-data/{symbol}`, enable it in `rh-agent-symbols/{symbol}`, and trigger a one-symbol RH Agent run so it is immediately reviewable.
- **Idempotency key**: combine `version` + `symbols[]` + `createdAtUTC`.

See `RH-AGENT-SYMBOL-ONBOARDING-2607-01_symbol-onboarding.md` for the full processing contract and example payload.

## Environments

- Use distinct service accounts per environment, if desired (staging vs prod).
- RSH maintains an email allowlist per environment via `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
- Use the correct base URL (audience) and endpoint per environment.

## Troubleshooting

- `401/403`:
  - Ensure you send an ID token (not access token) in `Authorization: Bearer <id_token>`.
  - `aud` must equal the base service URL (no path). Token issuer should be Google.
  - Confirm your service account email is allowlisted on RSH.
  - Cloud Run must grant `roles/run.invoker` to your SA on the RSH service (RSH will configure this).
- `400`:
  - Validate against the v1 schema. Ensure required fields are present and correctly typed.
- `5xx`:
  - Retry with backoff.

## Contact

Please share the service account email(s) you will use per environment so we can allowlist them and grant `run.invoker` on the RSH service. Provide the expected schedule for pre/post runs so we can monitor end-to-end. **Note:** We are currently awaiting the service account email(s) to be provided by SavantAPI. Once received, we will update the allowlist and grant the necessary permissions.
