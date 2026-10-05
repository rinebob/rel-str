**Topic:** Robinhood MCP
**Topic Slug:** robinhood-mcp
**Blueprint:** #680
**Task:** #684
**Issue:** #684
**Domain:** RH-MCP
**Type:** CODE-REVIEW
**Reviewed:** 2026-10-05
**Last Updated:** 2026-10-05
**Result:** PASS (1 round — 5 majors remediated in-session)

# Code Review — #684 Read-only sweep session

Axes: Standards (repo conventions) · Spec (task body + PRD/IMPL/TEST fit) · Thermo-nuclear (whole-change adversarial).

Scope: `probe-manifest.json` (233 entries — the deliverable), `captures/*.json` (235 files = 233 probe captures + 2 pre-existing #682 meta artifacts), TEST doc "Sweep execution results" section. No production code shipped under this task; `scripts/verify/rh-mcp-runner-683.ts` was repaired in-flight (positional-prompt bug exposed by manifest growth — see F-R1).

## Verdict: PASS

All four issue ACs met after one remediation round. Thermo-nuclear's 5 majors were all closed in-session by a remediation wave (18 additional probes + doc rewrites); nothing is deferred without a captured or documented rationale.

## Acceptance criteria

| AC | Result |
|---|---|
| Every read tool has ≥1 redacted capture | **MET** — 53/53 in-scope read/sim tools captured; 50 with ≥1 success (crypto tools + run_scan are error-only, environmentally gated, documented). |
| Every param appears in ≥1 captured request; enum exclusions carry rationale | **MET** — post-remediation, every top-level schema param on all 53 tools was sent, plus nested sub-params (`legs[].ratio_quantity`, `filters[].{expression,display_title,interval,length,plot}`, `columns[].{expression,visible,order}`, `tax_lots[]`). Only unsent params: 10 `cursor` fields on single-page ledgers (documented — no `next` emitted, no `limit` to force). |
| Per-call documented limits honored | **MET** — verified against the catalog (10-symbol caps, ≤4 price-book, ≤75 ratings, ≤3 filing_ids, ≤100 alert limit, [1,700] pair clamp, ±31 earnings days, ≤30/50 tax_lots, 1–4 legs, single-leg-only stop types, direction-required multi-leg). The >20-symbol quotes call is a deliberate `closes_error` capture. |
| Owner present; `--group`/`--only` step-through | **MET** — 15 manifest groups; `--group` (wave 1), `--only` (reruns), `--from` (waves 2–6) all exercised live; mutation gate fail-closed verified (`mut-eq-market-buy-01` auto-declined). |

## Axis summaries

**Standards** — 0 critical, 0 major. Secret hygiene verified three ways (mask-only `••••NNNN` forms; no 9-digit account values; no tokens/keys in 235 files). Manifest: unique ids, valid gates, `$ENV:` placeholders only, all tools in the live catalog. All minors fixed in-session.

**Spec** — all 4 ACs met after enumeration-join of manifest×captures×inputSchema. Spot-checked 12 captures — correct envelope (`id`/`tool`/`args`-as-`$ENV:`/`outcome`/`response` redacted). Deferral judgment: crypto + run_scan error-only captures are reasonable, not AC misses.

**Thermo-nuclear** — 0 critical, 5 majors (all remediated), plus minors/nits. Fairness notes from the axis: enum sampling substantive where it matters (all 18 indicator types, 9 scanner categories, all spans/bounds); dependency harvesting is legitimate live data; error-driven discovery is honest.

## Findings + dispositions

### Major — all remediated in-session

- **M1 `get_crypto_orders.order_id` unsent; 12 duplicate acct-gate errors.** → `dep-crypto-orders-13` sends `order_id` (synthetic UUID — account gate still fires first); TEST doc now annotates the error set as param-coverage evidence + one environmental-limit capture.
- **M2 `preview_scan` expression path unprobed.** → `dep-prev-scan-04` (numeric-predicate expression), `dep-prev-scan-05` (boolean `=`/`["True"]` form — **succeeded**, returned 397 live rows), `dep-prev-scan-03`/`06`/`07` cover `display_title`/`interval`/`length`/`plot` — including two live discoveries (display_title is expression-only; plot is not validated pre-flight → malformed DXFeed expression on RSI).
- **M3 `review_option_order` surface gaps.** → `stop_limit` (dep-13), `ratio_quantity` 1x2 ratio spread (dep-14), 4-leg order (dep-15 captured a live **direction-vs-pricing validation error**; dep-16 succeeded with `debit`), SPXW index legs with `underlying_type=index` + `regular_curb_hours`/`regular_curb_overnight_hours` (dep-17/18, both succeeded on a live SPXW instrument).
- **M4 TEST doc bookkeeping didn't reconcile.** → Rewritten: 233 probes/235 files, honest wave table, 53/50 tool counts, `dep-rev-opt-09` gap acknowledged.
- **M5 empty-ledger tools undocumented.** → TEST doc now lists the 8 `[]`-envelope tools + the all-null `get_realized_pnl` degenerate shape so #688 knows item field-trees can't be emitted there.

### Minor — fixed

- `expected:"success"` contradicted note/outcome on 10 error-evidence probes → corrected to `expected:"error"`.
- `dep-rev-opt-06` note claimed "expect refusal" but succeeded → note now records the discovery (review does NOT refuse close-without-position).
- `ro-eq-orders-03..06` notes claimed "identical empty-ledger envelope" — false on a 62-order ledger → corrected to representative-subset rationale.
- `ro-eq-hist-02`/`11` notes implied error captures retained → corrected (errors observed, captures overwritten by corrected reruns).
- TEST doc "4 other tools" cursor wording → 3 cursor + 1 offset, now explicit.

### Minor — accepted as documented limits

- `get_crypto_orders`/`preview_crypto_order` params past the account gate can't be evaluated — synthetic args exercise the wire format only; noted in TEST doc.
- `cursor` on 10 single-page ledger tools unreachable (no `next`, no `limit`); mechanics proven on 4 paginated tools (7 follow captures, 3-page chains on 2).
- `dep-prev-crypto-06` (gfm) + `dep-crypto-orders-13` (order_id) are acct-gated error captures by design — params sent, shapes documented as deferral.
- `dep-rev-opt-09` numbering gap — cosmetic, noted.
- Masked `upgrade_url`s in `ro-option-level-01`/`ro-limited-margin-01` — correct redaction, dead links accepted.
- `00-drift.json`/`01-live-tools-list.json` don't follow probe-capture schema — pre-existing meta artifacts; noted for #688's globber.

### Discoveries carried into the evidence base (new in remediation)

- `review_option_order` validates `direction` against live option pricing (dep-rev-opt-15 error → dep-rev-opt-16 success).
- `position_effect=close` with no open position is NOT refused at review time (dep-rev-opt-06).
- `preview_scan` boolean-expression form `predicate:"="` + `values:["True"]` works and returns live rows.
- `preview_scan` does NOT pre-validate `plot` — invalid filter+plot combos produce malformed DXFeed expressions server-side (dep-prev-scan-06 — candidate for a triage ticket).
- Catalog-vs-observed contradictions: `stop_market` documented "sell-to-close only" but buy-to-open review succeeded; `adjustment_type=all` documented "intraday only" but `day`+`all` succeeded.
- `run_scan` NotFound leaks raw truncated RPC text mid-word — error-envelope shape note for #687.
- Equity tool uses `limit_price`, option tool uses `price`; `market_hours` enums differ between the two review tools.

## Test results

- **Harness suite:** 118/118 `tsx --test` cases green (runner + manifest + drift).
- **Verify scripts:** `rh-mcp-manifest-681` 219/219; `rh-mcp-runner-683` 6/6 after in-flight repair (F-R1 below); `rh-mcp-drift-682` exercised during the run.
- **Manifest validation:** live `tools/list` dry-run — 231→233 probes validate clean.
- **Coverage join (enumerated):** 233/233 manifest ids ↔ capture files, 1:1, no orphans; 204 success / 28 error / 1 declined.
- Suite scope note: #684 shipped data artifacts only — no production code — so the full app jest suite wasn't run; the discovery-harness surface is the task's testable code and it's green.

### F-R1 — verify-script latent bug (found by review, fixed)

`rh-mcp-runner-683.ts` was authored against a 3-entry manifest: positional prompt answers (checkpoints consumed `y` before the mutation gate), hardcoded `RH_ACCOUNT_NUMBER`-only env, and a `get_equity_orders` call-count of 1. Manifest growth to 231 entries broke all three assumptions. Fixed: prompt routed by message shape, all three env vars injected, expected call count computed from the manifest. Now 6/6.

## Disposition

PASS. Task advances to `7_QA`. Remaining honest limits (crypto account absent, empty ledgers, single-page cursors) are environmental, documented, and captured as evidence — they constrain what the *shapes* show, not what the *coverage* proves.
