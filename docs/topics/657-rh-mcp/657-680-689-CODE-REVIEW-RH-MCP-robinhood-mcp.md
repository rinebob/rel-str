**Topic:** Robinhood MCP  
**Topic Slug:** rh-mcp  
**Thread:** Full RH MCP Tool Discovery  
**Thread Slug:** rh-mcp-full-tool-discovery  
**Issue:** #680  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Task:** #689  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# Code Review — Final discovery doc (safety, gaps, envelope) (#689)

## Verdict: **PASS** (with in-loop remediations)

| Axis | Result |
|---|---|
| Standards | Clean after remediation — misc-mut group well-formed, captures leak-free |
| Spec | All 4 ACs met after `cx-cancel` re-arm closed the last unprobed tool |
| Thermo-nuclear | 2 majors found and fixed in-loop (inverted drift claim; wrong allowlist claim), 2 minors fixed |

## Change set

No application code. `probe-manifest.json` (+18 `misc-mut` probes,
`cx-cancel` re-armed to a nil-order_id error probe), 18 new captures
(`wl-*`, `al-*`, `sc-*`, `cx-*`, `ox-*`), refreshed `00-drift.json` /
`01-live-tools-list.json`, hand-finished canonical doc, TEST doc session
section.

## Standards

- `misc-mut` entries consistent with the post-#686 convention: `env`
  declared on every probe using `$ENV:` placeholders, `redactFields`
  where account fields appear in args/response, unique ids, valid gates,
  dependent cancels carry skip/re-arm notes.
- Redaction sweep across **all 352 captures**: zero unmasked account
  numbers, zero tokens. Sole hit is `err-positions-bad-acct.json`'s
  intentional bogus `"account_number": "0"`.
- No U+FFFD anywhere in edited files; capture links 351/351 resolve.
- **Nit (pre-existing, not blocking):** 40 `mx-*` probes shipped under
  #685 use `$ENV:` placeholders without `env` declarations — cosmetic
  inconsistency vs. the newer convention; harmless since `requiredEnv`
  is loader-computed.

## Spec — AC accounting

| AC | Status |
|---|---|
| One doc, domain-group sections matching `robinhood-tools.ts` | **Met** — with a correction: `TOOL_GROUPS` defines **9** groups, not 6 (Crypto/Alerts/SEC Filings ARE in `ALL_ENABLED_TOOLS`; the AC's "6" was authored under a mistaken premise). Doc sections match the 9 real groups 1:1; the allowlist section documents the code, not the AC's count. |
| Every tool has params + observed response + notes | **Met** — after remediation: `cancel_crypto_order` was the last `unprobed` tool; re-armed `cx-cancel` with a nil `order_id` (harmless — matches no order) and captured the `no crypto account linked` envelope. Now 69 probed + 7 error-only = **76/76 tools with an observed envelope**. |
| Gaps documented verbatim; safety class per tool | **Met** — 14 verbatim gap callouts (trailing_stop workaround, no `delete_watchlist`/`delete_scan`, multi-leg 400, advisory-review divergence, stop_market-BTO 400, naked-STO "infinite risk", unconfirmed=resting, accepted≠cancelled, fractional regular-hours, ref_id 409, crypto gate, exercise constraints, schema drift). All three quoted 400s byte-verified against captures. Safety line on all 76 tool sections. |
| Redacted captures linked under topic dir | **Met** — 351 distinct capture links resolve; "committed" deferred to `/proj ship` per workflow. |

## Thermo-nuclear

- **MAJOR (fixed):** the drift gap-callout was **inverted** — it claimed
  "live requires `symbols`; catalog still lists `symbol`." Verified
  against `01-live-tools-list.json` + bundled catalog: live *added* a
  deprecated `symbol` param and *removed* `symbols` from `required`.
  A consumer following the old text would have read the schema backwards.
- **MAJOR (fixed):** the hand-finished allowlist section claimed
  Crypto/Alerts/SEC-Filings are "not in `TOOL_GROUPS`/`ALL_ENABLED_TOOLS`."
  False — the file defines 9 groups, all enabled. Corrected the section
  and posted a correction comment on #689.
- **MINOR (fixed):** safety-classification summary table said `read-only`
  = 63/76 and omitted `mark_alerts_read` from `account write`. True split
  vs. `MUTATION_TOOLS`/`SIMULATION_TOOLS`: 49 read-only / 8 financial
  mutation / 15 account write / 4 simulation = 76.
- **MINOR (fixed):** envelope section claimed "one of two envelopes" —
  a third `{"category":"VALIDATION","error":...}` shape exists in 2
  captures (runner-side ajv rejections, never reaches the wire).
  Qualified in place; `351`→`352` capture count updated.
- **Nit (accepted):** `cancel_crypto_order` can never show a success
  envelope on this account (no crypto account exists). `error-only` is
  the honest terminal state; probe note documents re-arm instructions.

## Test results

`npm run test:rh-agent-mcp-discovery` — **130/130 pass** (6 suites).
Manifest dry-run clean (settle-scope warnings on `mx-*` probes are
pre-existing and intentional).

## Residual notes

- Account residue to delete in-app: `MCP-DISCOVERY-TEST-2` watchlist +
  `MCP-DISCOVERY-TEST` scan (no delete tools exist — itself a documented
  gap).
- `env`-declaration inconsistency on the 40 `mx-*` probes is cosmetic;
  sweep them if a manifest hygiene pass ever runs.
