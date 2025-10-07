# SavantAPI → RSH Data-Ready Webhook Specification

## Overview
Purpose: enable SavantAPI to notify the RSH backend when a scheduled data load (e.g., pre/post close) is complete so RSH can begin RS computation and downstream processing without polling.

Scope: daily scheduled loads for OHLCV/metadata across supported intervals, with explicit pre/post phases. Intraday is out of scope for now.

## Goals
- Notify RSH that the latest dataset is ready to consume.
- Provide enough context for RSH to run idempotent processing keyed by `runId`.
- Keep the contract stable and versioned, decoupled from SavantAPI internals.

## High-Level Flow
1. SavantAPI completes a batch load (e.g., post-close).
2. SavantAPI sends a signed POST to an RSH Cloud Run HTTPS endpoint.
3. RSH verifies auth/signature, validates the schema, logs the event, and enqueues a Pub/Sub message keyed by `runId`.
4. RSH background worker processes pairs, updates Firestore (RS series, latest docs), generates canonical signals, and marks the run as completed.

## Endpoint
- Method: `POST`
- URL: `https://<rsh-cloud-run-host>/partner/data-ready`
- Content-Type: `application/json`
- Response semantics:
  - `202 Accepted` on successful enqueue; processing continues asynchronously.
  - `4xx` for auth/validation errors (do not retry).
  - `5xx` for transient failures (partner should retry with backoff).

## Authentication & Verification
Authentication is required via Google OIDC ID token only.

* Google OIDC ID token
  * Audience: the service URL.
  * RSH verifies issuer, audience, expiry, and that the calling service account email is allowlisted.
* Allowlist configuration: use environment variable `ALLOWED_SERVICE_ACCOUNT_EMAILS` to define permitted service account emails (comma-separated). This mirrors our standard gateway configuration and should be set distinctly per environment (staging/prod).

## Payload Schema (v1)
Top-level object with required fields. Include `version` for evolution.

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

Field definitions:
- `version` (string, required): “v1” initial contract.
- `runId` (string, required): unique identifier for the run (e.g., `YYYY-MM-DD-pre/post`); used for idempotency/deduplication.
- `phase` (string, required): `pre` | `post`.
- `intervals` (string[], required): e.g., `["DAILY"]`; later may include `WEEKLY`/`MONTHLY`.
- `baselinesUpdatedCount` (number, optional): count of baselines implicated by the run.
- `time` (number, required): epoch ms timestamp for the run.
- `symbolsUpdatedCount` (number, optional): count of updated symbols.
- `universeVersion` (string, optional): identifier for the symbol set snapshot used for this run.

### Recommended Additional Fields (v1-compatible)
These fields are optional in v1 but recommended to improve traceability, validation, and auditability. They do not change the success criteria.

```json
{
  "marketDate": "2025-09-11",
  "tz": "America/New_York",
  "durationMs": 238000,
  "phaseWindow": { "start": 1736719200000, "end": 1736726400000 },
  "datasetManifest": "gs://savantapi-datasets/2025-09-11/post/manifest.json",
  "env": "prod",
  "traceId": "2f2c3b5e7a..."
}
```

Field additions (optional):
- `marketDate` (string, YYYY-MM-DD): trading date the run applies to; avoids ambiguity with epoch `time`.
- `tz` (string): IANA timezone for the run (default `America/New_York`).
- `durationMs` (number): total batch duration for observability.
- `phaseWindow` (object): epoch ms window reflecting the data collection window for the phase.
- `datasetManifest` (string): pointer to a manifest (URL or Cloud Storage path) that enumerates dataset artifacts for auditing/backfills.
- `env` (string): `staging` | `prod` to assist cross-environment observability.
- `traceId` (string): correlation id to link SavantAPI pipeline logs to RSH processing.

## Examples

Minimal
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

Extended (with recommended optional fields)
```json
{
  "version": "v1",
  "runId": "2025-09-11-post",
  "phase": "post",
  "intervals": ["DAILY"],
  "time": 1736726400000,
  "marketDate": "2025-09-11",
  "tz": "America/New_York",
  "baselinesUpdatedCount": 20,
  "symbolsUpdatedCount": 500,
  "universeVersion": "us-eq-2025-09-11",
  "datasetManifest": "gs://savantapi-datasets/2025-09-11/post/manifest.json",
  "durationMs": 238000,
  "phaseWindow": { "start": 1736719200000, "end": 1736726400000 },
  "env": "prod",
  "traceId": "2f2c3b5e7a..."
}
```

## Idempotency & Retries
- Idempotency: RSH deduplicates by `runId`; replaying the same payload is safe.
- Retries: On `5xx`, retry with exponential backoff (e.g., several attempts over ~10–15 minutes). Do not retry on `4xx`.
- RSH returns `202` only after verification and enqueue completes.

## Validation Rules
- `version` must be recognized (`v1`).
- `runId` non-empty; recommended length <= 100 chars.
- `phase` ∈ {`pre`, `post`}.
- `intervals` ⊆ {`DAILY`, `WEEKLY`, `MONTHLY`}.
- `baselinesUpdatedCount` (if provided): non-negative integer.
- `symbolsUpdatedCount` (if provided): non-negative integer.
- `time` is positive epoch ms.
- 400 on schema errors; 401/403 on failed auth/signature.

Additional guidance (recommended):
- `intervals` MUST be a non-empty array and each value must be one of the allowed enums.
- `runId` format SHOULD be enforced as: `^\\d{4}-\\d{2}-\\d{2}-(pre|post)$` to guarantee high-quality idempotency keys.
- If `marketDate` is provided, `time` SHOULD fall within that UTC calendar day; if not, accept but log a validation warning.

## RSH Processing Contract
On `202` acceptance, RSH will:
1. Verify auth/signature and schema.
2. Log raw payload to `partnerEvents/{runId}` and upsert `runs/{runId}` with `status=received`.
3. Publish a Pub/Sub message to topic `rs-data-ready` with the payload.
4. Background worker (subscriber) will:
   - Enumerate `pairRegistry` (optionally narrow to provided `baselines`).
   - Compute RS for registered pairs; write `pairs/{BASE}_{SYMBOL}/rs/*` and update `pairs/{BASE}_{SYMBOL}/latest` (and optional `latest30`).
   - Generate canonical signals.
   - Update `runs/{runId}` with `status=completed`, processing counts, timings, and any warnings.

### Pub/Sub Message Attributes (for routing/observability)
When publishing to `rs-data-ready`, include attributes in addition to the JSON body:
- `runId`: string
- `version`: string (e.g., `v1`)
- `phase`: `pre` | `post`
- `marketDate`: YYYY-MM-DD (if provided)
- `env`: `staging` | `prod` (if provided)

These attributes enable lightweight filtering and metrics without parsing the message body.

## Security Requirements
- Enforce OIDC service account allowlist (no HMAC fallback).
- HTTPS only; enforce payload size cap (e.g., 1 MB).
- Optional Cloud Armor rate limiting/IP allowlist.
- Log verification failures with secret redaction.

Operational hardening:
- Configure per-environment `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
- Consider strict token `iat/exp` bounds and short acceptance windows.

## Versioning
- Include `version` in payload; new non-breaking fields may be added and ignored by default.
- Breaking changes require a version bump (`v2`) with an overlap period.

## SLAs & Ops
- Notification window: within minutes of batch completion.
- End-to-end target: RSH post-close RS fully computed within agreed timeframe (e.g., 30–60 min after data ready).
- Provide clear partner contact and escalation paths.

Observability & tracing:
- RSH returns an `X-Request-Id` header on `202` for partner correlation.
- Partners may include `traceId` in the payload to link pipeline logs end-to-end.

## Environments
- Separate staging and production endpoints and credentials.
- Share the partner service account identity for OIDC per environment (no shared secrets).

Environment guidance:
- Maintain distinct allowlists via `ALLOWED_SERVICE_ACCOUNT_EMAILS` for staging vs prod.
- If sending `env` in payload, ensure it matches the target endpoint environment for consistency.

## Testing Checklist
- OIDC verification succeeds on staging.
- Valid payload → `202 Accepted`; `runs/{runId}` shows `received`.
- Duplicate payload → `202 Accepted`; no duplicate processing.
- Invalid token/issuer/audience → `401/403`.
- Invalid schema → `400`.
- End-to-end subscriber run completes; `runs/{runId}` shows `completed` with counts.

Additional cases:
- Multiple same-day runs: (1) pre only, (2) post only, (3) pre then post, (4) duplicate post.
- `intervals` empty array or invalid values.
- `runId` not matching the recommended format.
- `marketDate` provided but `time` falls outside that UTC day (warning path).
- Pub/Sub publish failure → `5xx` (partner retries with backoff).

## Future Extensions
- Additional intervals (WEEKLY, MONTHLY) and mixed runs.
- Partial/backfill notifications with `meta.kind` = `backfill` and scope details.
- Error/health webhook from SavantAPI for upstream incident visibility.
