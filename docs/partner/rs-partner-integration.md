# RS Partner Integration (Single Source)

Audience: Relative Strength (RS) backend consuming Savant partner Pub/Sub and time‑series HTTPS.

Last updated: 2026-01-16

> **Transition note (RS contract):**
>
> Earlier iterations of this document assumed that RS would consume both:
>
> - Run‑level `partner-data-ready` messages (`runType=ts_daily_*`, `ts_weekly_*`, `ts_monthly_*`), **and**
> - A symbol‑level `partner-symbols-ready` stream to drive incremental ingestion.
>
> The **authoritative RS contract is now a single run‑level "universe ready" message** per trading day, implemented as a specific flavor of the existing `partner-data-ready` v1 message:
>
> - **Topic:** `partner-data-ready`
> - **Attributes:** `runType = "ts-post-all-intervals"`, `phase = "post"`
> - **Payload:** `intervals` includes `DAILY`, `WEEKLY`, `MONTHLY`.
>
> RS no longer depends on `partner-symbols-ready` for core ingestion and treats any symbol‑level stream as **optional and non‑authoritative**.
>
> **Current RS deployment (2026-01):**
> - The RS backend codebase still contains a symbol-driven subscriber (`processSymbolsReady`) wired to the `partner-symbols-ready` topic, but the Cloud Function exports are commented out in `functions/src/index.ts`, so no subscriber is deployed.
> - The `.env` flag `USE_SYMBOL_DRIVEN_PIPELINE` is set to `false`, so the pair-centric `processDataReadyRunV2` path driven by universe-ready `partner-data-ready` is the only ingestion path.
> - To intentionally re-enable the symbol-driven pipeline in the future, you must **both** uncomment the `processSymbolsReady` exports in `functions/src/index.ts` and set `USE_SYMBOL_DRIVEN_PIPELINE=true` in `functions/.env.rel-str` before redeploying functions.

---

## 1) What this covers

- Time‑series job pipeline schedules and cadence (PRE/POST, DAILY/WEEKLY/MONTHLY)
- Run‑level readiness payloads, attributes, `runId`, `runType`, and `marketDate`
- **Universe‑ready** `partner-data-ready` message (runType=`ts-post-all-intervals`, phase=`post`) used by RS as the ingestion trigger
- Background on legacy `partner-data-ready` v1 payloads and `runs/{runId}` updates
- Legacy/optional symbol‑level readiness stream (`partner-symbols-ready`)
- References to HTTPS endpoints and auth

---

## 2) Schedules & Cadence (Trading Days, ET)

The Savant time‑series job pipeline still runs **multiple PRE/POST jobs** per trading day. RS, however, only ingests after a single **universe‑ready POST signal**.

- PRE (intraday snapshots; no finalize)
  - 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 15:30 ET
  - `runType=ts_daily_pre`
- POST (finalized writes)
  - Initial: 16:35 ET
  - Evening retries: 18:30, 19:00, 19:30, 20:00, 20:30, 21:00, 21:30 ET
  - Morning catchups: 06:30, 07:00 ET (next trading morning)
  - `runType=ts_daily_post`
- Weekly/Monthly POST: 16:40 ET (`runType=ts_weekly_post` / `ts_monthly_post`)
- Weekends/Holidays: No runs

On top of these, Savant emits a **universe‑level readiness message** once the TS job pipeline has finalized the symbol universe for the day (see Section 3.2). RS uses that message as the **single ingestion trigger**.

---

## 3) Run‑Level Payloads

### 3.1 Legacy `partner-data-ready` v1 (background)

Minimal v1 (still used by non‑RS consumers):

```json
{
  "version": "v1",
  "runId": "2025-09-11-post",
  "phase": "post",
  "intervals": ["DAILY"],
  "time": 1736726400000
}
```

Extended fields:

- `marketDate`: `YYYY-MM-DD`
- `counts`: `{ pendingCount, finalizedCountTotal, deltaCount }`
- `timing.finalizedAtUTC`: ISO when first finalized bars were detected for the day
- `timing.nextRefreshAtUTC`: ISO next scheduled refresh
- Header: `runStatus` → `processing` | `completed`

RS continues to accept these for observability, but **does not** start a second time‑series fetch loop from generic `partner-data-ready` messages. The authoritative ingestion trigger is the **universe‑ready `partner-data-ready` variant** described below.

### 3.2 Universe‑Ready `partner-data-ready` (RS contract)

RS subscribes to a **single universe‑ready `partner-data-ready` message** per trading day. Conceptual payload (Savant side):

```jsonc
{
  "version": "v1",
  "runId": "2026-01-16-post-all-intervals-v1",
  "marketDate": "2026-01-16",
  "phase": "post",
  "intervals": ["DAILY", "WEEKLY", "MONTHLY"],
  "universeVersion": "v1",
  "status": "completed"  // or "completed_with_errors"
}
```

Trigger identity for RS:

- **Topic:** `partner-data-ready`
- **Attributes (canonical RS filter):**

  ```text
  attributes.runType = "ts-post-all-intervals" AND attributes.phase = "post"
  ```

- **Payload constraint:** `intervals` includes `"DAILY"`, `"WEEKLY"`, and `"MONTHLY"`.

Semantics for RS:

- Exactly **one all‑intervals POST** message per `{marketDate, universeVersion}` once Savant confirms that all required time‑series jobs are terminal for the RS universe.
- The message asserts that **all symbols RS cares about are ready** (or explicitly marked as permanent failures) for the specified `intervals`.
- RS treats this as the **single authoritative trigger** to:
  - Run its unified ingestion engine for the given `marketDate` across the pair registry.
  - Use Savant time‑series HTTPS as the single source of bars for DAILY/WEEKLY/MONTHLY.
  - Record ingestion status and errors in `pair-registry` and related state.

> RS may still refer to this internally using its own enum/name for the **universe-ready `ts-post-all-intervals` run** in TypeScript contracts or Firestore docs, but **Savant only sends `runType`** on the wire; there is no separate universe Pub/Sub topic or additional `type` field in the partner payload.

---

## 4) Attributes & Identifiers

- `runType` (time‑series jobs, legacy/non‑RS consumers): `ts-daily-pre` | `ts-daily-post` | `ts-weekly-post` | `ts-monthly-post`
- `runType` (universe‑ready, RS‑primary): `ts-post-all-intervals`
- `phase`:
  - `pre` / `post` (RS keys on `phase = "post"` for universe‑ready runs)
- `runId` (examples):
  - Scheduled TS jobs: `YYYY-MM-DD-pre` | `YYYY-MM-DD-post`
  - Manual/test TS jobs: `YYYY-MM-DD-pre-<suffix>` / `YYYY-MM-DD-post-<suffix>` (1–16 lowercase letters/digits)
  - Universe‑ready runs: `YYYY-MM-DD-post-all-intervals-<suffix>` (convention; only needs to be unique per `{marketDate, universeVersion}`).

Subscription filters:

- **RS live ingestion (universe‑ready):**

  ```text
  attributes.runType = "ts-post-all-intervals" AND attributes.phase = "post"
  ```

- Other time‑series consumers may still subscribe to more granular TS runs, for example:
  - Finalized daily: `attributes.runType = "ts-daily-post"`
  - Daily only (both): `attributes.runType = "ts-daily-pre" OR attributes.runType = "ts-daily-post"`

---

## 5) Message Behavior and Runs Document

For **time‑series runs** (PRE/POST, DAILY/WEEKLY/MONTHLY):

- Every scheduled invocation publishes two messages for the same per‑day/per‑phase `runId`:
  - BEGIN → `runStatus=processing`
  - END → metrics, optional `remainingSymbols` sample (POST only)
- All invocations for the same phase/day update the same Firestore document:
  - `runs/{YYYY-MM-DD-pre}` or `runs/{YYYY-MM-DD-post}`
- END updates are idempotent‑friendly; subsequent invocations refresh the same `runs` doc fields.

For the **universe‑ready `partner-data-ready` variant** (`runType = "ts-post-all-intervals"`, `phase = "post"`):

- A small aggregator monitors job completion for the RS universe.
- When the universe is finalized for `{marketDate, phase=post}`, it emits a **single `partner-data-ready` v1 message** with `runType="ts-post-all-intervals"`, and updates a corresponding `runs/{runId}` or `system/time-series-status` doc with aggregate status.
- RS treats this all‑intervals POST message as its **only required Pub/Sub trigger** for live ingestion.

---

## 6) Finalization & Overnight Continuation (POST)

For the **time‑series job pipeline**:

- Finalization markers:
  - `timing.finalizedAtUTC` appears when first finalized bars are detected for the day
  - Root transparency doc: `system/time-series-finalization/daily-adjusted/{marketDate}` (FYI)
- Continuation logic:
  - Tracks symbols finalized before run start vs those finalized during the run
  - Computes pending; when few remain, runs a targeted acceleration pass
  - END payload may include a small `remainingSymbols` sample if pending > 0

For **RS ingestion**:

- RS waits for the **all‑intervals POST `partner-data-ready` message** (`runType = "ts-post-all-intervals"`, `phase = "post"`, `intervals` includes `DAILY`, `WEEKLY`, `MONTHLY`) that reflects the finalized status of the RS universe for that day.
- Manual/correction time‑series runs (e.g., `runId` with `-manual-*` suffix) may still exist, but RS can be configured to either:
  - Ignore them entirely, or
  - Treat them as **explicit repair triggers** wired into the unified ingestion engine.

---

## 7) Endpoints & Auth (Pointers)

- HTTPS endpoints:
  - Time series: `partnerTimeSeriesV2` (GET)
  - Tracked symbols: `partnerListTrackedSymbolsV2` (GET)
- Auth: Google OIDC ID token (SA allowlisted, `aud` set to function URL, include email)

See:
- API surface: `docs/partner-api-surface.md`
- Discovery: `docs/partner-discovery.md`
- Integration (auth/examples): `docs/partner-integration.md`

---

## 8) Quick Start (RS‑focused)

- Subscribe to the **universe‑ready `partner-data-ready` stream** with filter:

  ```text
  attributes.runType = "ts-post-all-intervals" AND attributes.phase = "post"
  ```

- On each such message:
  - Read `marketDate`, `runId`, `intervals`, `status`, and any `universeVersion` fields.
  - Invoke the RS unified ingestion engine for that `{marketDate, intervals}` over all registered pairs, using Savant time‑series HTTPS as the single source.
  - Optionally treat `status = "completed_with_errors"` as a hint to schedule repair/backfill.
- Treat all other `partner-data-ready` messages as **diagnostic only** for RS; do not start a second ingestion pass from them.
- Ignore (or explicitly fence off) manual/correction runs unless intentionally wired as repair flows.

---

## 9) Symbol‑Level Readiness Stream (Legacy / Optional)

For most use cases, partners can continue to treat TS_UNIVERSE / `partner-data-ready` as the **run‑level** contract. The time‑series job pipeline may additionally expose a **symbol‑level stream** for consumers that want low‑latency, per‑symbol updates.

> **Important (RS policy):** RS no longer treats any symbol‑level stream as authoritative for ingestion. The details below are retained as **background/legacy design notes** for other consumers.

- **Topic:** typically `partner-symbols-ready`
- **Payload (conceptual):

  ```json
  {
    "version": "v1",
    "marketDate": "YYYY-MM-DD",
    "runId": "YYYY-MM-DD-HHMM-post",   // optional link to run-level event
    "symbols": ["AVGO", "MSFT", "SPY"],
    "reason": "scheduled"              // or "backfill"
  }
  ```

- **Semantics:**
  - Each message contains a **batch of symbols** that have just become fully ready for the given `marketDate` based on job‑doc state in `time-series-jobs/{marketDate}/jobs`.
  - Intervals (DAILY/WEEKLY/MONTHLY) are resolved internally; consumers do **not** need to track per‑interval readiness.
  - The stream is **additive**: symbols may appear in one or more batches, but the authoritative completion signal for a run remains the **TS_UNIVERSE / universe‑ready** message.

RS’s unified ingestion engine is explicitly **run‑driven**, not symbol‑driven. Any future symbol‑level usage must feed into that engine via well‑defined repair or diagnostics flows, not as a separate ingestion path. In the current deployment, RS does **not** subscribe to `partner-symbols-ready` at all; see the transition note at the top of this document for the exact flags/exports that would need to change to revive the symbol-driven subscriber.

---

## 10) Troubleshooting

- Ensure subscription filter matches exact `runType`
- Expect multiple BEGIN/END pairs per trading day for the same POST `runId` (evening/morning retries)
- Use `marketDate` (if present) to key per‑day logic

---

## 10) Operational Appendix (RS)

- Auth (server‑to‑server):
  - Google OIDC ID token from an allowlisted service account (SA)
  - Cloud Run IAM: grant `roles/run.invoker` to the SA
  - Token: `aud` must equal the function URL; include the `email` claim (`--include-email`)

- Symbol universe:
  - `partnerListTrackedSymbolsV2` (GET): `?activeOnly=true&limit=500`

- Example (curl):
  ```bash
  HOST="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net"
  URL_TS="${HOST}/partnerTimeSeriesV2"
  TOKEN_TS="$(gcloud auth print-identity-token --audiences="${URL_TS}" --include-email)"
  curl -s -H "Authorization: Bearer ${TOKEN_TS}" \
    "${URL_TS}?symbol=AAPL&interval=DAILY&range=1y"
  ```

- Idempotency & checkpointing:
  - Treat one RS compute per trading day; dedupe with `runId`/`marketDate`
  - Persist a per‑day checkpoint (processed/completed) to avoid repeats

- Monitoring:
  - Track subscription lag, errors, and RS daily completion by `marketDate`
  - Suggested log fields: `component=rs`, `marketDate`, `runId`, `symbolsProcessed`, `durationMs`, `status`

- Security:
  - Server‑to‑server only; rotate SA credentials; prefer keyless workload identity where possible

References:
- `docs/partner-integration.md` (auth details, examples)
- `docs/partner-api-surface.md` (endpoints overview)
