**Topic:** Robinhood MCP  
**Topic Slug:** rh-mcp  
**Thread:** Full RH MCP Tool Discovery  
**Thread Slug:** rh-mcp-full-tool-discovery  
**Issue:** #680  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Task:** #685  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# Code Review — OOMA equity order matrix session (#685)

## Verdict: **PASS** (with in-loop remediations)

| Axis | Result |
|---|---|
| Standards | PASS — minors only, all remediated in-session |
| Spec | MET-WITH-DEVIATION — all 4 ACs satisfied modulo documented residuals; 2 MEDIUM evidence gaps closed in-session |
| Integrity (self) | 46 probes ↔ 49 `mx-*` captures; joins clean; zero unredacted UUIDs |

## Scope

Data-capture task — the "code" surface is one diagnostics patch plus manifest
and capture artifacts:

- `functions/src/rh-agent-mcp/diagnostics/run-probe-manifest.ts` —
  `RH_PROBE_AUTOYES` opt-in inside `makePrompt()`
- `docs/topics/657-rh-mcp/probe-manifest.json` — 42 planned + 4 session-added
  `eq-matrix` probes; `symbol`→`symbols` migration; env-driven ref_ids
- `docs/topics/657-rh-mcp/captures/mx-*.json` — 49 files (46 probe captures +
  3 hand captures)
- `functions/.rh-mcp-tool-catalog.json` — regenerated 2026-10-07 (76 tools)
- TEST doc — session results, abort-procedure correction, #686 runbook
- Canonical doc regenerated (76 tools / 313 probes / 313 captures)

## Standards findings

- **AUTOYES scoping verified precise** — only the `execute <id> (<tool>)? 'y'
  run` gate message matches; retry gates, settle timeouts, and checkpoints
  still fail closed. Fail-closed default preserved without the env var; the
  auto-answer is logged for auditability. Regex failure mode is safe (if gate
  wording changes it silently fails closed).
- **Minor — fixed:** "no bypass flag" contract text was stale in the header,
  usage text, and `meta.gates` — now documents `RH_PROBE_AUTOYES` (invocation-
  scoped env, not a CLI flag; explicitly warned off `.env.local`).
- **Minor — fixed:** noted that AUTOYES's regex would also match the post-
  failure RETRY re-gate (unreachable today since the failure prompt still
  reads 'n'); comment added flagging the coupling for any future retry
  auto-answer.
- **Minor — fixed:** ad-hoc probes' `redactFields` normalized to the
  `["account_number"]` sibling convention (+ `limit_price` on the xh sell);
  run-on notes punctuated; manifest `env` field variance noted as
  non-functional (loader computes `requiredEnv` from placeholders).
- **Minor — fixed:** TEST doc probe count corrected 41 → 42 planned (+4
  session-added).
- **Nit — accepted:** `makePrompt` untested (not exported; injected-prompt
  seam is the testable unit) — acceptable for diagnostics tooling.

## Spec findings

All matrix rows verified against captures individually:

- **AC1 (every row captured)** — MET-WITH-DEVIATION: `mx-can-lots`
  intentionally skipped (tax_lots 400 reject left nothing live); all
  rejections verbatim.
- **AC2 (stop-direction semantics)** — MET-WITH-DEVIATION: buy-stop-below
  auto-cancels server-side (terminal state inferred — settle block drops the
  name when settled); sell-stop-above rests `queued` (placed 16:01 ET —
  queued-vs-armed ambiguity noted honestly in TEST doc).
- **AC3 (ref_id + tax_lots)** — MET: verbatim 409 on replay; tax_lots rejected
  at all three layers (lots list `is_selectable:false`, review alert
  `EQUITY_TAX_LOT_STALE`, place 400).
- **AC4 (account ends flat)** — MET-WITH-DEVIATION: 0.252705 fractional
  remainder is structurally unsellable post-close (fractional =
  regular_hours-only, corroborated by `extended_hours_fractional_tradability:
  false` on ro-eq-tradability-01). Residual action documented; end-state now
  evidenced by `mx-pos-postflat` + refreshed `mx-orders-confirmed`.

**Remediated in-session:**
- MEDIUM — verbatim "fractional/dollar orders are regular_hours-only" reject
  was overwritten by mx-sell-flat-xh's success → re-captured via new
  `mx-sell-xh-frac` probe.
- MEDIUM — end-state was narrative-only → `mx-pos-postflat` capture +
  `mx-orders-confirmed` rerun now evidence 0.252705 residual + zero resting
  OOMA orders.
- LOW — narrative timestamp corrected (flat-out was placed 16:26 ET, after
  close — not "through the close").
- LOW — `EQUITY_TAX_LOT_STALE` advisory alert added to session results.
- LOW — mojibake in `mx-buy-lim-bid-filled.json` (cp1252 double-encode of
  the `••••` redaction mask) repaired; sibling hand captures verified clean.

## Test results

- `npm run build` — green
- `npm run test:rh-agent-mcp-discovery` — **130/130 pass**

## Residual / deferred

- Sell 0.252705 OOMA fractional during regular hours to fully satisfy AC4
  (one market sell; documented in TEST doc + issue comment).
- `mx-sell-stp-hi`'s resting-state name (`queued` vs `confirmed`) is worth a
  follow-up probe in regular hours — a sell-stop placed mid-session should
  show `confirmed`; post-close `queued` may reflect next-session queueing.
