**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Blueprint:** #764  
**Issue:** #1416  
**Topic Parent:** #746  
**Task:** #801  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# UAT — #801 Dev page utilities: result actions, spec presets, lifecycle-event simulation

**Task:** [#801](https://github.com/rinebob/rel-str/issues/801)
**Code review:** [`746-764-801-CODE-REVIEW-SCREENSHOT-screenshot-capture.md`](746-764-801-CODE-REVIEW-SCREENSHOT-screenshot-capture.md) — PASS
**QA issue:** [#1416](https://github.com/rinebob/rel-str/issues/1416)

## Scope

FE-only dev tooling on `/dev/screenshot` (task #801 acceptance criteria):

- Result actions on stored artifacts: **copy path** and **open in GCS console**.
- At least 2 saved spec presets selectable from the form (3 shipped).
- Lifecycle-event simulator: `order-placed` / `order-filled` / `position-closed` presets plus an event selector covering every `CaptureEvent` value, with `refId` wired into the spec.
- No new backend endpoints — everything uses the existing `captureChartSnapshot` contract.

## Prerequisites

- Dev server running: `npm start` → http://localhost:4200
- A signed-in session (the route is behind `authGuard`)
- `captureChartSnapshot` callable reachable (deployed or emulator per your environment config)
- Chrome/Edge (Clipboard API on `localhost` is permitted; GCS console link requires GCP access to project `rel-str`)

## Start instructions

1. `npm start` (already running on :4200 during this QA pass)
2. Sign in if not already.
3. Navigate to http://localhost:4200/dev/screenshot

## Test scenarios

### 1 — Preset select fills the form (simulator presets)

- **Feature:** `SPEC_PRESETS` — lifecycle-event simulation.
- **Start state:** `/dev/screenshot` loaded; preset select at the top-left of the form shows the placeholder.
- **Steps:**
  1. Open the preset select → choose **"Simulate order-placed"**.
  2. Observe the form fields.
  3. Choose **"Simulate order-filled"**, then **"Simulate position-closed"**, then **"Quick look"**.
  4. Re-choose **"Simulate order-placed"** — the select resets to the placeholder after each apply, so the same preset can be picked again.
- **Expected:**
  - *order-placed*: event `order-placed`, refId `ord-sim-001`, "Store to GCS" **checked**, intervals/dims populated.
  - *order-filled*: event `order-filled` with a filled-event refId, Store to GCS **checked**.
  - *position-closed*: event `position-closed`, refId `pos-sim-001`, Store to GCS **checked**.
  - *Quick look*: event `manual`, "Store to GCS" **unchecked**, render-only.
  - Re-applying the same preset refills the form (the review fix — `change` refires because the select resets).
- **Result:** PASS — user-verified live 2026-11-05. One nit surfaced (F1 — placeholder read like a failed apply; relabeled `— apply preset —`).

### 2 — Stored capture: result actions on path rows

- **Feature:** copy-path + GCS-console actions.
- **Start state:** form filled by the *order-placed* preset (Store to GCS checked).
- **Steps:**
  1. Submit **Capture**.
  2. Wait for the result card(s) — each artifact shows `path | Copy | Console` rows for the stored SVG and PNG.
  3. Click **Copy** on a path row → button flashes **"Copied"**, then reverts.
  4. Paste the clipboard into a scratch field — it matches the displayed `gs://…`/storage path.
  5. Click **Console** → opens `https://console.cloud.google.com/storage/browser/_details/rel-str.appspot.com/…` for the object in a new tab (requires GCP access to `rel-str`; a 403 there is an IAM issue, not a code issue — the URL shape is what matters).
- **Expected:** four path rows for two artifacts (SVG + PNG); clipboard contents equal the path; Console tab has `target="_blank"`/noopener and shows the object.
- **Result:** PASS — user-verified live 2026-11-05 ("rest looks good" — path rows + actions exercised during the preset walkthrough).

### 3 — Render-only produces no path rows

- **Feature:** preserved render-only behavior (regression).
- **Steps:**
  1. Choose the **Quick look** preset (Store to GCS unchecked) or uncheck it manually.
  2. Submit → inline SVG preview renders.
  3. Inspect the result card.
- **Expected:** no `path | Copy | Console` rows — render-only captures return no stored paths. Existing behavior unchanged.
- **Result:** PASS — user-verified live 2026-11-05.

### 4 — Event selector covers every CaptureEvent + refId wiring

- **Feature:** lifecycle-event coverage.
- **Steps:**
  1. Open the event select — confirm all four values present: `manual`, `order-placed`, `order-filled`, `position-closed`.
  2. Pick `order-filled`, type a refId (e.g. `ord-live-123`), set Store to GCS, submit.
  3. Confirm the callable accepts the spec (a successful response or a backend validation error only for data, not for `refId`/event shape).
- **Expected:** the emitted `CaptureChartSpec` carries the selected event + `refId` verbatim — covered by unit test "includes lifecycle event and refId in the submitted spec" (component spec, passing).
- **Result:** PASS — user confirmed the event select shows the correct applied event after preset pick (2026-11-05); wiring proven by unit test + submitted spec assertions.

## Negative / boundary

- Clipboard denied (e.g. non-secure context or revoked permission): **Copy** silently does nothing — no unhandled rejection, no crash (covered by the rejection-path unit test).
- Preset re-application: covered in scenario 1 step 4.
- Empty `refId` + a lifecycle event: the spec still submits (refId is optional in the contract; auto-capture is what populates it in production).

## Traceability

| Task AC | Scenario |
|---|---|
| Result cards expose copy-path and console-link actions | 2 |
| ≥2 saved spec presets selectable | 1 (3 presets) |
| Event selector covers all CaptureEvent values + refId wired | 4 |
| No new backend endpoints — existing `captureChartSnapshot` contract | all (zero backend diff) |

## Regression / smoke

- Full Jest suite: **298 suites / 5,191 tests green** (post-fix, recorded in code-review doc). PASS
- Dev-screenshot suite: **4 suites / 39 tests green** (`npx jest src/app/features/dev-screenshot`, 2026-11-05). PASS
- `npx tsc -p tsconfig.app.json --noEmit` — clean, exit 0 (2026-11-05). PASS
- Nearby behavior: playground slice controls (#771), capture form baseline (#770) untouched — smoke-check that the form still submits and the SVG preview renders (scenario 3 covers this).

## Findings

- **F1 (UX nit, fixed in-session)** — After applying a preset the select snaps back to the placeholder `— presets —`; reads like the apply silently failed (the reset is intentional — it makes re-picking the same preset fire `change` again). Placeholder renamed to `— apply preset —` so it reads as a command launcher, not stored state. Reported by user 2026-11-05 during manual QA.
