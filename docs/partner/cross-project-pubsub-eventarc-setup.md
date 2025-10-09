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
- [Appendix: Useful Commands](#appendix-useful-commands)

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

- Remove test/temporary subscriptions in the Publisher project after verification:

```bash
gcloud pubsub subscriptions delete temp-verify-sub --project=<PUBLISHER_PROJECT_ID> --quiet
```

- Remove unused IAM bindings (e.g., legacy Subscriber `roles/pubsub.subscriber` on the topic).

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
