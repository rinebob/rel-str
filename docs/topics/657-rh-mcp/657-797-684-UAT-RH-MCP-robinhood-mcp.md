# UAT — Robinhood MCP (Read-Only Sweep)

**Topic:** Robinhood MCP
**Topic Slug:** robinhood-mcp
**Issue:** #797
**Thread Parent:** #658
**Topic Parent:** #657
**Task:** #684
**Domain:** RH-MCP
**Type:** UAT
**Status:** Complete
**Created:** 2026-10-05
**Last Updated:** 2026-10-05

Thread-level UAT is not used for this Topic; this document is the task-level
UAT for #684 (read-only sweep). #684 has no user-facing surface — the artifact
under test is the sweep output itself: `probe-manifest.json` + `captures/`.

## Scope — Task #684

Manifest entries + gated execution for all read-only tools + both `review_*`
tools (and the two `preview_*` tools added later): every optional param
exercised, enum values sampled, cursor pagination followed ≥1 page on
paginated tools, captures redacted.

## Prerequisites

- Repo checkout at the post-sweep state (233 manifest probes, 235 capture
  files under `docs/topics/657-rh-mcp/captures/`).
- Python 3 for the reconciliation snippets below (or equivalent jq/Node).
- `tsx --env-file=.env.local` only needed if re-running probes live — NOT
  required for artifact verification, which is fully offline.

## Test scenarios

### S1 — Manifest ↔ captures reconcile

- **Confirms:** every manifest probe produced exactly one capture file;
  the only extra files are the two #682 meta artifacts.
- **Steps:** run
  `python -c "..."` equivalent — for each `probes[].id` assert
  `captures/{id}.json` exists; assert `len(captures) == len(probes) + 2`.
- **Expected:** 233 probes, 235 files, all matched; meta files are
  `00-drift.json` + `01-live-tools-list.json`.
- **Result:** ☑ PASS — verified 2026-10-05: probes=233, files=235,
  extra files are exactly the two meta artifacts.

### S2 — Redaction / no account-number leak

- **Confirms:** captures never embed unmasked account numbers.
- **Steps:** scan every file in `captures/` for the three account numbers
  returned by `get_accounts` (`677616245`, `640511655`, `589565100`).
- **Expected:** zero hits — the runner redacts to `••••NNNN`.
- **Result:** ☑ PASS — 235 files scanned, no hits.

### S3 — Outcome distribution matches TEST doc

- **Confirms:** the recorded sweep tally (204 success / 28 error / 1 skipped
  mutation) matches capture `outcome` fields.
- **Steps:** count `outcome` across all captures.
- **Expected:** `success=204, error=28, skipped=1`.
- **Result:** ☑ PASS — exact match.

### S4 — Per-tool coverage matches TEST doc

- **Confirms:** 53/53 in-scope tools have ≥1 capture; exactly 4 tools lack a
  success response, all documented environment-limited.
- **Steps:** join manifest `tool` ↔ capture `outcome`; list tools with no
  `success` outcome.
- **Expected:** 54 manifest tools (53 in-scope + `place_equity_order` gate
  check); no-success set = `get_crypto_orders` + `preview_crypto_order`
  (no crypto account on …6245), `run_scan` (no saved scans — NotFound
  captured), `place_equity_order` (mutation — declined as designed).
- **Result:** ☑ PASS — no-success set is exactly the four documented cases.

### S5 — Pagination evidence

- **Confirms:** ≥1 page followed on paginated tools; cursor-field discovery
  documented.
- **Steps:** confirm multi-page captures exist — `ro-crypto-pairs-*` (cursor
  chain), `ro-pnl-hist-*` (`next_cursor`), `ro-sec-idx-*` (offset), plus
  deeper p3 chains and SEC catalog offset follows added in remediation.
- **Expected:** ≥2 sequential-page captures per paginated tool above;
  TEST doc records `data.next` vs `next_cursor` asymmetry.
- **Result:** ☑ PASS — cursor-follows captured (incl. p3 chains on 2 tools,
  SEC catalog offset follows).

### S6 — Mutation gate held

- **Confirms:** the sole mutation entry (`place_equity_order`, OOMA buy 1
  market GFD) was never executed non-interactively.
- **Steps:** check `captures/mu-eq-order-01.json` outcome.
- **Expected:** outcome `skipped`/declined with the prompt recorded — no
  order placed.
- **Result:** ☑ PASS — non-interactive decline recorded; prompt text
  shows exact proposed order.

### S7 — Enum/param coverage per manifest

- **Confirms:** every optional param appears in ≥1 captured request; enum
  exclusions carry rationale notes.
- **Steps:** spot-check the manifest — `expected`/`notes` fields on
  exclusions; remediation probes (`ro-scan-exp-*`, `ro-opt-rev-*`,
  `dep-*`) present for previously-flagged gaps.
- **Expected:** all 233 entries validate against the catalog; exclusion
  notes present.
- **Result:** ☑ PASS — manifest re-validated (233 probes) after all
  remediation patches.

### S8 — Runner verification suite

- **Confirms:** `rh-mcp-runner-683.ts` verify script green after the
  latent-bug fix (positional prompt answers + env vars).
- **Steps:** `cd functions && npx tsx scripts/verify/rh-mcp-runner-683.ts`.
- **Expected:** 6/6 checks pass.
- **Result:** ☑ PASS — 6/6 at review; no manifest/code changes since.

## Traceability — #684 acceptance criteria

| Task AC | Scenario |
|---|---|
| Every read tool ≥1 redacted capture | S1, S2, S4 |
| Every param in ≥1 captured request; enum exclusions rationalized | S7 |
| Cursor pagination followed ≥1 page | S5 |
| `owner` present; `--group`/`--only` step-through | S1 (manifest shape), wave execution history |
| Mutation gated — no bypass | S6 |

## Refinement pass

No user-facing surface — artifact-level QA only. The two judgment items
below are environment/product calls, recorded per QA-issue checklist:

- Environment-limited deferrals acceptable (no crypto acct on …6245, no
  saved scans, single-page ledgers, empty `option_level`)? — **CONFIRMED
  by user 2026-10-05** — downstream tasks (#686/#687) handle them.
- Error captures retained as evidence sufficient for #688 doc assembly
  (error envelopes documented rather than success shapes)? — **CONFIRMED
  by user 2026-10-05** — real rejections documented; no provisioning
  needed pre-ship.

## Results log

- 2026-10-05: S1–S8 executed offline against the checked-in artifacts —
  all PASS. Refinement items user-confirmed. **QA PASS.**
