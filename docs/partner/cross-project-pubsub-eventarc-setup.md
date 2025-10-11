# Cross-Project Pub/Sub + Eventarc Setup for Data-Ready Events

This guide documents how to wire a Publisher project (source) and a Subscriber project (destination) so Pub/Sub topic events deliver to a Cloud Functions (Gen 2) service via Eventarc. It includes required APIs, IAM, trigger creation, testing, troubleshooting, and least-privilege notes.

Use this as a blueprint for additional Subscriber sites. Replace placeholders with each site’s project IDs and numbers.

- Example Publisher project: `alpha-vantage-proxy-api`
- Example Subscriber project: `rel-str`
- Example Pub/Sub topic: `projects/alpha-vantage-proxy-api/topics/partner-data-ready`
- Example Function: `processDataReadyRun` (Cloud Functions v2, region `us-central1`)
- Event type: `google.cloud.pubsub.topic.v1.messagePublished`

---

## Table of Contents
- [Production vs Emulator Quick Reference](#production-vs-emulator-quick-reference)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Identities and Roles](#identities-and-roles)
- [Grant IAM (Publisher/source)](#grant-iam-publishersource)
- [Grant IAM (Subscriber/destination)](#grant-iam-subscriberdestination)
- [Create/Update the Trigger](#createupdate-the-trigger)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Least-Privilege Hardening](#least-privilege-hardening)
- [Multi-Subscriber Pattern](#multi-subscriber-pattern)
- [Cleanup](#cleanup)
- [Local Emulator Setup (Pub/Sub + Functions v2 + OIDC)](#local-emulator-setup-pubsub--functions-v2--oidc)
- [Stabilize IAM Across Deploys (No more post-deploy rebinding)](#stabilize-iam-across-deploys-no-more-post-deploy-rebinding)
- [Appendix: Useful Commands](#appendix-useful-commands)

---

## Production vs Emulator Quick Reference

| Concern | Production | Emulator |
|---|---|---|
| Pub/Sub Topic | `projects/alpha-vantage-proxy-api/topics/partner-data-ready` | `projects/rel-str/topics/partner-data-ready` |
| Project Namespace | Publisher topic in upstream project; Eventarc trigger in Subscriber project | Single local namespace `rel-str` for topic and subscription |
| Subscription Creation | Eventarc-managed subscription created in Subscriber project during deploy | Functions emulator creates subscription at startup if the topic exists |
| Function Trigger Binding | `onMessagePublished({ topic: 'projects/alpha-vantage-proxy-api/topics/partner-data-ready', region: 'us-central1' })` | Guard in code: when `FUNCTIONS_EMULATOR==='true'` bind to `projects/rel-str/topics/partner-data-ready` |
| Message Publish | `gcloud pubsub topics publish projects/alpha-vantage-proxy-api/topics/partner-data-ready ...` | `npm run pubsub:hb` or `npm run pubsub:run` (or POST to `http://127.0.0.1:8085/v1/projects/rel-str/topics/partner-data-ready:publish`) |
| Persistence | Real Pub/Sub and Eventarc; persistent | Emulator is in-memory; persist via `npm run emulators:export` and import on start |
| OIDC Credentials | Cloud Run Invoker granted to runtime SA; identity from Cloud Functions runtime | Set `GOOGLE_APPLICATION_CREDENTIALS` to a JSON key for `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`; `partner-proxy` uses `GoogleAuth().getIdTokenClient(PARTNER_AUDIENCE)` |
| Firestore Target | Real Firestore in Subscriber project | Firestore emulator (`pairs/*`, `partner-events/*`) |
| Start/Stop | Deploy via Firebase/GCP; no emulator | `npm run emulators:start` / `npm run emulators:stop` |
| Topic Creation | Managed upstream; no manual step | `npm run pubsub:topic` (once per fresh emulator session, or rely on import) |

Tip: Ensure the emulator topic exists before Functions emulator starts, so the subscription is created automatically. If you create the topic after starting, restart emulators.

---

## Architecture

- The Publisher emits "Data-Ready" events to a Pub/Sub topic living in the Publisher project.
- Subscriber(s) use Eventarc in their own project to attach a subscription to that topic and deliver events to a Cloud Run–backed Cloud Function (Gen 2).
- This naturally supports fan-out: each Subscriber attaches its own Eventarc-managed subscription to the same topic.

Diagram (conceptual):

Publisher project (Topic) -> Eventarc (in Subscriber project) -> Cloud Run service (Functions v2) -> Business logic / Firestore writes

---

## Prerequisites

Enable the following APIs in both Publisher and Subscriber projects:

- Cloud Functions v2: `cloudfunctions.googleapis.com`
- Cloud Run: `run.googleapis.com`
- Eventarc: `eventarc.googleapis.com`
- Pub/Sub: `pubsub.googleapis.com`
- Cloud Build (for deployments): `cloudbuild.googleapis.com`
- Artifact Registry: `artifactregistry.googleapis.com`

Command (replace `<PROJECT_ID>`):

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project=<PROJECT_ID>
```

Region alignment: use the same region across Eventarc trigger and Cloud Function (e.g., `us-central1`).

---

## Identities and Roles

Subscriber project (destination, e.g., `rel-str`):

- Cloud Functions service agent (Google-managed):
  - `service-<SUBSCRIBER_NUMBER>@gcf-admin-robot.iam.gserviceaccount.com`
- Eventarc service agent (Google-managed):
  - `service-<SUBSCRIBER_NUMBER>@gcp-sa-eventarc.iam.gserviceaccount.com`
- Cloud Run service agent (Google-managed):
  - `service-<SUBSCRIBER_NUMBER>@serverless-robot-prod.iam.gserviceaccount.com`
- Function runtime service account (can be default or custom):
  - `<SUBSCRIBER_NUMBER>-compute@developer.gserviceaccount.com` (or your custom SA)

Publisher project (source, e.g., `alpha-vantage-proxy-api`):
- Pub/Sub topic lives here.
- Must grant `attachSubscription` on the topic to three Subscriber agents (see next section).

---

## Grant IAM (Publisher/source)

Grant topic-level role to the three Subscriber service agents. Simplest working role is `roles/pubsub.editor` (includes `pubsub.topics.attachSubscription`). Replace `<SUBSCRIBER_NUMBER>`.

```bash
TOPIC="projects/alpha-vantage-proxy-api/topics/partner-data-ready"

# Cloud Functions service agent
gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --member="serviceAccount:service-<SUBSCRIBER_NUMBER>@gcf-admin-robot.iam.gserviceaccount.com" \
  --role="roles/pubsub.editor" \
  --project=alpha-vantage-proxy-api

# Eventarc service agent
gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --member="serviceAccount:service-<SUBSCRIBER_NUMBER>@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/pubsub.editor" \
  --project=alpha-vantage-proxy-api

# Cloud Run service agent
gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --member="serviceAccount:service-<SUBSCRIBER_NUMBER>@serverless-robot-prod.iam.gserviceaccount.com" \
  --role="roles/pubsub.editor" \
  --project=alpha-vantage-proxy-api
```

Optional cleanup (Publisher): remove unused direct subscriber bindings, e.g., `roles/pubsub.subscriber` for `rel-str@appspot.gserviceaccount.com` if not used.

---

## Grant IAM (Subscriber/destination)

Grant Subscriber-side roles so the function can be deployed and invoked:

Project-level (destination project):

```bash
# Allow CF service agent to manage Eventarc and Cloud Run
gcloud projects add-iam-policy-binding <SUBSCRIBER_PROJECT_ID> \
  --member="serviceAccount:service-<SUBSCRIBER_NUMBER>@gcf-admin-robot.iam.gserviceaccount.com" \
  --role="roles/eventarc.admin"

gcloud projects add-iam-policy-binding <SUBSCRIBER_PROJECT_ID> \
  --member="serviceAccount:service-<SUBSCRIBER_NUMBER>@gcf-admin-robot.iam.gserviceaccount.com" \
  --role="roles/run.admin"

# Allow Eventarc service agent to invoke your Cloud Run service
gcloud projects add-iam-policy-binding <SUBSCRIBER_PROJECT_ID> \
  --member="serviceAccount:service-<SUBSCRIBER_NUMBER>@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# Allow CF service agent to use your runtime SA
gcloud iam service-accounts add-iam-policy-binding <SUBSCRIBER_NUMBER>-compute@developer.gserviceaccount.com \
  --member="serviceAccount:service-<SUBSCRIBER_NUMBER>@gcf-admin-robot.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser" \
  --project=<SUBSCRIBER_PROJECT_ID>
```

Notes:
- You do not need to grant users roles like `roles/eventarc.admin` or `roles/run.admin` (project Owner is enough for deployment oversight). Keep human access minimal.

---

## Create/Update the Trigger

Preferred (via Functions v2 deploy)

Ensure your function uses the full source topic with `onMessagePublished` and deploy from the Subscriber project:

```ts
// Example (Functions v2) - in your code
onMessagePublished({ topic: "projects/alpha-vantage-proxy-api/topics/partner-data-ready", region: "us-central1" }, handler)
```

Deploy (Subscriber project):
```bash
firebase deploy --only functions:<YOUR_FUNCTION_NAME> --project=<SUBSCRIBER_PROJECT_ID>
```

Alternative (explicit Eventarc):
```bash
gcloud eventarc triggers create <TRIGGER_NAME> \
  --location=us-central1 \
  --event-filters="type=google.cloud.pubsub.topic.v1.messagePublished" \
  --transport-topic="projects/alpha-vantage-proxy-api/topics/partner-data-ready" \
  --destination-run-service="<RUN_SERVICE_NAME>" \
  --destination-run-region="us-central1" \
  --service-account="<SUBSCRIBER_NUMBER>-compute@developer.gserviceaccount.com" \
  --project=<SUBSCRIBER_PROJECT_ID>
```

---

## Testing

Publish from the Publisher project. Two safe patterns:

Attributes-only (quote the list):

```powershell
$env:PROJECT_SAVANT="alpha-vantage-proxy-api"
$env:FULL_TOPIC="projects/$env:PROJECT_SAVANT/topics/partner-data-ready"

gcloud pubsub topics publish $env:FULL_TOPIC \
  --message="{}" \
  --attribute="runType=ts_daily_post,runId=test-XYZ" \
  --project=$env:PROJECT_SAVANT
```

Payload-only (recommended to avoid shell quoting issues):

```bash
PROJECT_SAVANT=alpha-vantage-proxy-api
FULL_TOPIC="projects/$PROJECT_SAVANT/topics/partner-data-ready"

gcloud pubsub topics publish "$FULL_TOPIC" \
  --message='{"runId":"test-XYZ","runType":"ts_daily_post"}' \
  --project="$PROJECT_SAVANT"
```

Verify (Subscriber project):

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="<RUN_SERVICE_NAME>"' \
  --project=<SUBSCRIBER_PROJECT_ID> \
  --limit=30 \
  --order=desc \
  --format='value(timestamp, textPayload)'
```

Check Firestore for `runs/<runId>` document if your function writes status there.

---

## Troubleshooting

- No recent logs for your runId:
  - Confirm the trigger points to the Publisher topic:
    ```bash
    gcloud eventarc triggers describe <TRIGGER_NAME> --location=us-central1 --project=<SUBSCRIBER_PROJECT_ID>
    ```
  - Check Eventarc delivery logs:
    ```bash
    gcloud logging read 'protoPayload.serviceName="eventarc.googleapis.com" AND resource.labels.trigger_name="<TRIGGER_NAME>"' \
      --project=<SUBSCRIBER_PROJECT_ID> --order=desc --limit=100 --freshness="1h"
    ```
  - Ensure topic IAM in the Publisher includes the three Subscriber service agents with `attachSubscription` capability (e.g., `roles/pubsub.editor`).
  - IAM changes can take a few minutes to propagate.

- 403 during trigger creation:
  - Ensure CF service agent has `roles/eventarc.admin` and `roles/run.admin` (Subscriber).
  - Ensure Eventarc SA has `roles/run.invoker` (Subscriber).
  - Ensure Publisher topic grants the three Subscriber agents `attachSubscription`.

- Attributes parsed wrong (shell quoting):
  - Wrap the attribute list in quotes as shown above.
  - Or publish payload-only and let the function read `runType`/`runId` from JSON.

- Verify attachSubscription permission with Policy Troubleshooter:
  ```bash
  gcloud policy-troubleshoot iam "//pubsub.googleapis.com/projects/<PUBLISHER_PROJECT_ID>/topics/partner-data-ready" \
    --permission="pubsub.topics.attachSubscription" \
    --principal-email="service-<SUBSCRIBER_NUMBER>@gcf-admin-robot.iam.gserviceaccount.com"
  ```

---

## Least-Privilege Hardening

The minimal permission needed on the topic is `pubsub.topics.attachSubscription`.

For strict least-privilege:
- Create a custom role in the Publisher project with only `pubsub.topics.attachSubscription`.
- Bind that custom role at the topic level to each of the three Subscriber service agents.
- Remove `roles/pubsub.editor`.

> Note: `roles/pubsub.editor` is commonly used for convenience and works, but it grants broader Pub/Sub permissions than necessary.

---

## Multi-Subscriber Pattern

For each additional Subscriber project:
- Repeat the Subscriber IAM grants in that project (CF SA, Eventarc SA, Run SA, runtime SA user binding).
- In the Publisher project, grant topic-level `attachSubscription` role to that new Subscriber’s three service agents.
- Create that Subscriber’s Eventarc trigger pointing at the same Publisher topic.

This enables fan-out without code changes in the Publisher.

---

## Cleanup

- Remove unused direct subscriber bindings on the topic (e.g., `roles/pubsub.subscriber` for `rel-str@appspot.gserviceaccount.com` if not used).
- Remove unused Eventarc triggers.
- Remove unused Cloud Functions and Cloud Run services.

---

## Local Emulator Setup (Pub/Sub + Functions v2 + OIDC)

This section documents how to reproduce the cross‑project topology locally using the Firebase Emulator Suite while still calling the real Partner Time Series API via Google OIDC.

Key differences when emulating:
- The Pub/Sub emulator runs under your local project namespace (e.g., `rel-str`).
- The Functions emulator can subscribe to a different topic name than production. In code, guard with `FUNCTIONS_EMULATOR==='true'` to switch topic strings.
- Emulator topics/subscriptions are ephemeral unless exported/imported.
- Functions emulator code must use ADC for OIDC; do not pass OAuth scopes together with `target_audience`.

### 1) Wire the Functions subscriber to the emulator topic

In `functions/src/webhooks/partner-webhooks.ts`:
```ts
// Emulator: projects/rel-str/topics/partner-data-ready
// Prod: projects/alpha-vantage-proxy-api/topics/partner-data-ready
const PARTNER_DATA_READY_TOPIC =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? 'projects/rel-str/topics/partner-data-ready'
    : 'projects/alpha-vantage-proxy-api/topics/partner-data-ready';
```

Start emulators after building functions so the subscriber registers:
```bash
npm run emulators:start
```

Create the emulator topic (first session or when import is empty):
```bash
npm run pubsub:topic
```

Verify topic and subscription exist:
```bash
npm run pubsub:list:topics
npm run pubsub:list:subs
```
You should see a subscription like `projects/rel-str/subscriptions/emulator-sub-partner-data-ready`.

### 2) Persist emulator state across sessions

- To save topics/subscriptions and Firestore data:
```bash
npm run emulators:export
```
- `emulators:start` uses `--import=.firebase/emulator-data` so the next session will restore the state.
- `emulators:stop` is configured to export first, then stop processes.

### 3) Enable OIDC to the Partner API from the emulator

- Create a JSON key for the caller SA (per environment policy). For rel‑str:
  - `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
  - Store under `keys/` in the repo root and ensure it’s git‑ignored.
- Set ADC before starting emulators so `google-auth-library` can mint ID tokens:
```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="$(Get-Location)\keys\rel-str-partner-caller-prod.json"
```
- Ensure the SA has Cloud Run Invoker on the Partner Time Series Cloud Run service.
- In `functions/src/partner-proxy.ts`, use an ID token client without scopes:
```ts
const auth = new GoogleAuth();
return auth.getIdTokenClient(PARTNER_AUDIENCE);
```
Passing OAuth scopes together with `target_audience` causes: `invalid_request: cannot specify both scope and target audience in jwt.`

### 4) Local test commands

- Seed pair registry (HTTP function):
```bash
curl -sS -X POST "http://127.0.0.1:5002/rel-str/us-central1/seedPairRegistryManual" -H "Content-Type: application/json" -d '{}'
```
- Publish heartbeat to emulator topic:
```bash
npm run pubsub:hb
```
- Publish data‑ready to emulator topic (auto runId):
```bash
npm run pubsub:run
```
- Observe in Emulator UI (http://127.0.0.1:4010):
  - `partner-events/*` status transitions
  - `pairs/{BASELINE}-{TARGET}` with `series`, `seriesMeta`, and `latest`

### 5) Troubleshooting (emulator)

- 404 Topic not found: Create the topic before publishing and before starting emulators, or create then restart so the subscriber registers.
- No subscription listed: Ensure the topic existed when the Functions emulator started; restart after creating the topic.
- 403 from Partner API: Verify SA Run Invoker on the Cloud Run service, ADC env var points to the correct key, and `PARTNER_AUDIENCE` matches the Cloud Run URL.
- Pub/Sub messages not processed: Confirm the emulator project namespace (`rel-str`) matches both the topic and the subscriber binding when `FUNCTIONS_EMULATOR==='true'`.

---

## Stabilize IAM Across Deploys (No more post-deploy rebinding)

When Functions v2 services are recreated/rotated, per-service IAM on the Cloud Run service can be lost. To avoid repeated 403 “not authenticated” errors after deploys, set these bindings at the project level and configure impersonation once:

1) Project-level Run Invoker for caller identities (Subscriber project)

```bash
# Partner caller SA (trigger will impersonate this)
gcloud projects add-iam-policy-binding <SUBSCRIBER_PROJECT_ID> \
  --member="serviceAccount:<PARTNER_CALLER_SA>" \
  --role="roles/run.invoker"

# Eventarc service agent
gcloud projects add-iam-policy-binding <SUBSCRIBER_PROJECT_ID> \
  --member="serviceAccount:service-<SUBSCRIBER_NUMBER>@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# Pub/Sub service agent (used in some delivery paths)
gcloud projects add-iam-policy-binding <SUBSCRIBER_PROJECT_ID> \
  --member="serviceAccount:service-<SUBSCRIBER_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# Cloud Functions service agent (CFv2 orchestration)
gcloud projects add-iam-policy-binding <SUBSCRIBER_PROJECT_ID> \
  --member="serviceAccount:service-<SUBSCRIBER_NUMBER>@gcf-admin-robot.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

2) Allow Eventarc to impersonate the partner caller SA (to mint the OIDC token)

```bash
gcloud iam service-accounts add-iam-policy-binding <PARTNER_CALLER_SA> \
  --member="serviceAccount:service-<SUBSCRIBER_NUMBER>@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=<SUBSCRIBER_PROJECT_ID>
```

3) Keep (optional) service-level Run Invoker on the Cloud Run service for belt-and-suspenders

```bash
gcloud run services add-iam-policy-binding <RUN_SERVICE_NAME> \
  --region=us-central1 \
  --member="serviceAccount:<PARTNER_CALLER_SA>" \
  --role="roles/run.invoker" \
  --project=<SUBSCRIBER_PROJECT_ID>
```

Notes
- The Functions v2 auto-managed Eventarc trigger is expected and may be recreated on deploys. Do not delete it. Avoid creating a duplicate manual trigger for the same function.
- If you do need a manual trigger (advanced scenarios), ensure its `--service-account` matches `<PARTNER_CALLER_SA>` and that steps (1) and (2) above are configured.

---

## Appendix: Useful Commands

List subscriptions on the topic (Publisher):
```bash
gcloud pubsub topics list-subscriptions projects/<PUBLISHER_PROJECT_ID>/topics/partner-data-ready --project=<PUBLISHER_PROJECT_ID>
```

Topic IAM (Publisher):
```bash
gcloud pubsub topics get-iam-policy projects/<PUBLISHER_PROJECT_ID>/topics/partner-data-ready \
  --project=<PUBLISHER_PROJECT_ID> \
  --format="table(bindings.role, bindings.members)"
```

Subscriber project IAM (quick table):
```bash
gcloud projects get-iam-policy <SUBSCRIBER_PROJECT_ID> --format="table(bindings.role, bindings.members)"
```

Describe Eventarc trigger (Subscriber):
```bash
gcloud eventarc triggers describe <TRIGGER_NAME> --location=us-central1 --project=<SUBSCRIBER_PROJECT_ID>
```

Function logs (Subscriber):
```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="<RUN_SERVICE_NAME>"' \
  --project=<SUBSCRIBER_PROJECT_ID> \
  --limit=30 \
  --order=desc \
  --format='value(timestamp, textPayload)'
```

---

## Resolved placeholders (rel-str environment)

- SUBSCRIBER_PROJECT_ID: `rel-str`
- SUBSCRIBER_NUMBER: `145446780542`
- PUBLISHER_PROJECT_ID: `alpha-vantage-proxy-api`
- TOPIC: `projects/alpha-vantage-proxy-api/topics/partner-data-ready`
- RUN_SERVICE_NAME: `processdatareadyrun`
- FUNCTION_NAME: `processDataReadyRun`
- PARTNER_CALLER_SA: `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`

Use the ready-to-run commands below for this environment. The original, parameterized commands remain for reuse in other environments.

---

## Grant IAM (Publisher/source)

Ready-to-run (Publisher/source)

```bash
TOPIC="projects/alpha-vantage-proxy-api/topics/partner-data-ready"

# Cloud Functions service agent (Subscriber number 145446780542)
gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --member="serviceAccount:service-145446780542@gcf-admin-robot.iam.gserviceaccount.com" \
  --role="roles/pubsub.editor" \
  --project=alpha-vantage-proxy-api

# Eventarc service agent
gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --member="serviceAccount:service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/pubsub.editor" \
  --project=alpha-vantage-proxy-api

# Cloud Run service agent
gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --member="serviceAccount:service-145446780542@serverless-robot-prod.iam.gserviceaccount.com" \
  --role="roles/pubsub.editor" \
  --project=alpha-vantage-proxy-api
```

---

## Grant IAM (Subscriber/destination)

```bash
# Allow CF service agent to manage Eventarc and Cloud Run
gcloud projects add-iam-policy-binding rel-str \
  --member="serviceAccount:service-145446780542@gcf-admin-robot.iam.gserviceaccount.com" \
  --role="roles/eventarc.admin"

gcloud projects add-iam-policy-binding rel-str \
  --member="serviceAccount:service-145446780542@gcf-admin-robot.iam.gserviceaccount.com" \
  --role="roles/run.admin"

# Allow Eventarc service agent to invoke your Cloud Run service
gcloud projects add-iam-policy-binding rel-str \
  --member="serviceAccount:service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# Allow CF service agent to use your runtime SA (if using default compute SA)
gcloud iam service-accounts add-iam-policy-binding 145446780542-compute@developer.gserviceaccount.com \
  --member="serviceAccount:service-145446780542@gcf-admin-robot.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser" \
  --project=rel-str
```

---

## Create/Update the Trigger

```ts
// Example (Functions v2) - in your code
onMessagePublished({ topic: "projects/alpha-vantage-proxy-api/topics/partner-data-ready", region: "us-central1" }, handler)
```

```bash
firebase deploy --only functions:processDataReadyRun --project=rel-str
```

```bash
gcloud eventarc triggers create data-ready-relstr \
  --location=us-central1 \
  --event-filters="type=google.cloud.pubsub.topic.v1.messagePublished" \
  --transport-topic="projects/alpha-vantage-proxy-api/topics/partner-data-ready" \
  --destination-run-service="processdatareadyrun" \
  --destination-run-region="us-central1" \
  --service-account="rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com" \
  --project=rel-str
```

---
