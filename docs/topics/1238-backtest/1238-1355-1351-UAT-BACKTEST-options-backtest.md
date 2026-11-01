# UAT — #1351 Selection Replay UI polish + pick-doc contract alignment

**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1355  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1351  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

## Scope

Two changesets shipping together:

1. **#1351 dialog polish** — the New Replay dialog's start date is three Year/Month/Day `mat-select`s (impossible dates unconstructable; leap-aware; clamping on month/year/day change), the year list is floored at 2026, the symbols field is ~200px, the default start is 2026-01-01, and the emitted `OptionsReplayStartRequest` payload is unchanged.
2. **Pick-doc client contract alignment** (thread maintenance) — `partnerPickDocTransport` targets `partnerOptionsDeltaPicksV1` with `symbol/type/delta/dte/year` params, unwraps `{ok:true,…}`, 502s on any 200 lacking `ok:true` + `days`, propagates `OPTIONS_NOT_ENABLED` 404s, skips `NOT_FOUND` 404s as shard gaps (with a `partnerPickDoc_shard_skipped` warn), and rejects malformed/inverted date windows as 400.

## Prerequisites

- Repo `C:\aa\projects\rel-str`, branch `prod`, deps installed (`npm install`, `functions/npm install`).
- Frontend checks: `npx jest options-replay --coverage=false`.
- Backend checks: `npx tsx --test tests/functions/options-replay/pick-doc-client.test.ts`.
- UI pass: `npm start` (or the deployed app once shipped) → **Savant Trader → Backtest** (`/options/strategy/backtest`) → **New Replay**.

## Scenarios

### S1 — Dialog renders the new date controls

- **State:** app running, on `/options/strategy/backtest`.
- **Steps:** click **New Replay**.
- **Expect:** template select (name + description in options), symbols field ~200px wide, then **Year / Month / Day** selects on the same row — no native `type="date"` input, no calendar popup.
- **Result:**

### S2 — Defaults

- **Steps:** open the dialog fresh.
- **Expect:** Year = 2026, Month = Jan, Day = 1; symbols field prefilled `QQQ`; template defaults to the first `REPLAY_TEMPLATES` entry.
- **Result:**

### S3 — Impossible dates unconstructable

- **Steps:** set Month = Feb, Year = 2026 → open the Day dropdown and count.
- **Expect:** Day options are 1–28 only (Feb 2026). Set Year = 2024 (only if 2024 were offered — it is not; year floor prevents this entirely).
- **Result:**

### S4 — Month/year change clamps the day

- **Steps:** set Jan 31 → change Month to Feb.
- **Expect:** Day snaps to 28 (not an error state, not a blank). Repeat: Feb (leap-impossible years are not offered, so the leap path is exercised via unit specs only — see S8).
- **Result:**

### S5 — Year floor

- **Steps:** open the Year dropdown.
- **Expect:** options run current-year → 2026, nothing earlier. (In 2026 the list is exactly `[2026]`.)
- **Result:**

### S6 — Payload unchanged

- **Steps:** template = any, symbols `spy, qqq  amat`, start 2026-01-05 → **Start Replay**.
- **Expect:** dialog closes with `{templateId, symbols: ['SPY','QQQ','AMAT'], startDate: '2026-01-05'}` — observable via a new run appearing in the Options Replay section whose run doc carries `startDate: '2026-01-05'` (Firestore console: `st-options-replay-runs/{runId}`).
- **Result:**

### S7 — Negative: empty symbols

- **Steps:** clear symbols (or enter ` , , `) → **Start Replay**.
- **Expect:** dialog stays open, symbols field shows the required error; `dialogRef.close` never fires.
- **Result:**

### S8 — Automated unit coverage (all of the above, plus leap/setValue edges)

- **Steps:** `npx jest options-replay-new-run-dialog --coverage=false`
- **Expect:** 13 specs pass — template binding, panel contents, payload emit, default 2026-01-01, zero-padding, Feb-28/Feb-29 day lists, month-shrink clamp, **year-change leap clamp** (Feb 29 2024 → 2025 → 28), **programmatic setValue clamp** (`{month:2, day:31}` → 28), year floor, empty-parse guard, cancel.
- **Result:**

### S9 — Pick-doc wire contract (fetch-stubbed)

- **Steps:** `npx tsx --test tests/functions/options-replay/pick-doc-client.test.ts`
- **Expect:** 20 specs pass — shard-request shape, multi-year sweep, `NOT_FOUND` skip, all-404 → coordinate-named 404, malformed/5-digit/inverted windows → 400, `OPTIONS_NOT_ENABLED` propagates on first shard and mid-sweep, merge metadata, and 6 wire-contract specs (V1 URL + `delta=` param + Bearer header, `{ok:true}` unwrap, `ok:false`/`ok`-absent/no-`days` → 502, invalid JSON → 502, upstream-404 code extraction).
- **Result:**

### S10 — Typecheck + build

- **Steps:** `npm run typecheck:tests`; `npm --prefix functions run build`; `npx jest options-replay --coverage=false`.
- **Expect:** zero errors in `pick-doc-client.*` and `options-replay-new-run-dialog.*` files (pre-existing `signal-date-writer.test.ts` errors are topic 984-1019's, out of scope); functions build clean; 75/75 jest.
- **Result:**

### S11 — Regression: unchanged surfaces

- **Steps:** open the Options Replay section — run list + run detail + contract table + series dialog all render as before; the **New Backtest** sim dialog is untouched.
- **Expect:** no visual or behavioral change outside the New Replay dialog.
- **Result:**

## Traceability

| Criterion | Scenario |
|---|---|
| Y/M/D selects; impossible dates unconstructable; leap-aware clamp | S3, S4, S8 |
| Year floored at grid coverage; default 2026-01-01 | S2, S5, S8 |
| Symbols field ~200px | S1 |
| Payload shape unchanged `OptionsReplayStartRequest` | S6, S8 |
| Client hits `partnerOptionsDeltaPicksV1` w/ `delta` param | S9 |
| `{ok:true,…}` envelope; malformed 200 → 502 | S9 |
| `OPTIONS_NOT_ENABLED` propagates; `NOT_FOUND` skips | S9 |
| Each fix spec-covered; jest + tsx + typecheck green | S8, S9, S10 |
| No regression to neighboring replay/backtest UI | S11 |

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| S1–S7 | PASS | User ran the live dialog end-to-end (deployed app): submitted a real replay run — the dialog's Y/M/D selects, defaults, and payload produced a valid `optionsReplayStart` call; the run reached the worker and reported the honest coordinate-named error (pre-deploy 404 path). User-confirmed. |
| S8 | PASS | 13/13 jest `options-replay-new-run-dialog` |
| S9 | PASS | 20/20 `tsx --test pick-doc-client.test.ts` |
| S10 | PASS | typecheck clean (in-scope), functions build clean, 75/75 jest `options-replay` |
| S11 | PASS | New Backtest dialog and all replay surfaces unchanged — user-confirmed during the live run |
