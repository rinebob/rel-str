# Verification Scripts Index

## Overview

Permanent, committed verification scripts that exercise the real (prod) pipeline.
These are NOT part of the test suite — they hit live services and must be run
deliberately, on-demand.

## Tasks

| Task | Guide | Pipeline Stage | Scripts |
|---|---|---|---|
| #240 — BE Normalize Robinhood Orders | [savant-trader-broker-orders.md](savant-trader-broker-orders.md) | MCP call → normalize → output | `savant-trader-broker-orders-list.ts`, `savant-trader-broker-orders-get.ts`, `savant-trader-broker-positions-list.ts` |
| #334 — FE Swing Analysis Store | [indicator-lib-swing-analysis.md](indicator-lib-swing-analysis.md) | Firestore path construction + round-trip | `indicator-lib-swing-analysis-store.ts` |
| #560 — SHARED Paper Trading Contracts | [paper-trading-contracts-560.md](paper-trading-contracts-560.md) | IDs + collection paths + kind guards | `paper-trading-contracts-560-ids.ts` |
| #561 — BE Ledger Core | [paper-trading-ledger-561.md](paper-trading-ledger-561.md) | fill → ledger → Firestore persist (account + trade atomic write) | `functions/scripts/verify/paper-trading-ledger-561.ts` (needs ADC; runs from `functions/`) |
| #562 — BE Engine Migration | [paper-trading-engine-migration-562.md](paper-trading-engine-migration-562.md) | legacy options-strategy-* → `paper-trading/{anchor}/items` + Position-view adapter + P&L parity | `functions/scripts/verify/paper-trading-engine-migration-562.ts` + `functions/scripts/migrate-options-strategy-to-paper.ts` (needs ADC; runs from `functions/`) |
| #563 — BE Exit Engine | [paper-trading-exit-eval-563.md](paper-trading-exit-eval-563.md) | nightly variant eval → governing closing fill via ledger / shadow exitEvents / mark-gap + sentinel tolerance | `functions/scripts/verify/paper-trading-exit-eval-563.ts` (needs ADC; runs from `functions/`) |
| #564 — BE Signal→paper path | [paper-trading-signal-order-564.md](paper-trading-signal-order-564.md) | order-ticket → `paperSignalOrder` (equity fill + cohort + PENDING expressions) → noon fill pass (chains → instruments → quotes → selection → OPEN) | `functions/scripts/verify/paper-trading-signal-order-564.ts` (needs ADC + local RH MCP OAuth; runs from `functions/`) |
| #565 — BE Read APIs + stats scopes | [paper-trading-read-apis-565.md](paper-trading-read-apis-565.md) | generalized stats pass (all/inst/var/cohort/sig/sym scopes) + listPaperTrades / getPaperStats / getPaperAccount / listExitVariants callables | `functions/scripts/verify/paper-trading-read-apis-565.ts` (needs ADC; runs from `functions/`) |
| #665 — SHARED Trade Exits contracts | [paper-trading-contracts-665.md](paper-trading-contracts-665.md) | `CANCELLED` status, `trailing-8` defaults, `TERMINAL_VARIANT_FAMILIES`, close/cancel callable shapes | `paper-trading-contracts-665.ts` (no credentials) |
| #666 — BE Pending cancel | [paper-trading-cancel-666.md](paper-trading-cancel-666.md) | PENDING→CANCELLED txn seam + `cancelPaperTrade` handler guards + no cash movement | `functions/scripts/verify/paper-trading-cancel-666.ts` (needs ADC; runs from `functions/`) |
| #667 — BE Live-quote close | [paper-trading-close-667.md](paper-trading-close-667.md) | OPEN→CLOSED at live RH quote + governing run finalized + guards | `functions/scripts/verify/paper-trading-close-667.ts` (needs ADC + RH MCP; runs from `functions/`) |
| #669 — BE Trade-exits composed verify | [paper-trading-trade-exits-669.md](paper-trading-trade-exits-669.md) | prod seeding audit + governingVariant resolution + seed guards + cancel/close guards | `functions/scripts/verify/paper-trading-trade-exits-669.ts` (needs ADC; runs from `functions/`) |
| #676 — BE Signal-trade mark coverage | [paper-trading-signal-marks-676.md](paper-trading-signal-marks-676.md) | nightly marks on OPEN signal-source trades so governing stops can eval | `functions/scripts/verify/paper-trading-signal-marks-676.ts` (needs ADC + local RH MCP; runs from `functions/`) |
| #720 — BE Signal-trade settlement | [paper-trading-signal-settlement-720.md](paper-trading-signal-settlement-720.md) | expired signal option legs settle — worthless / intrinsic, account + governing run finalized | `functions/scripts/verify/paper-trading-signal-settlement-720.ts` (needs ADC; runs from `functions/`) |
| #724 — BE Engine settlement parity | [paper-trading-engine-settlement-724.md](paper-trading-engine-settlement-724.md) | engine settle retries missed nights (`<=`) + weekend expiry walks back to prior trading day | `functions/scripts/verify/paper-trading-engine-settlement-724.ts` (needs ADC; runs from `functions/`) |
| #605 — FE swing-config library | [swing-analysis-misc-fixes-605.md](swing-analysis-misc-fixes-605.md) | `st-swing-configs` slim-doc write → read → idempotent overwrite → userId list → delete | `swing-analysis-misc-fixes-605-config-library.ts` (needs ADC) |
| #586 — FE Allocation services | [portfolio-allocation-586.md](portfolio-allocation-586.md) | `portfolio/{buckets,attributions}/items` round-trip — bucket CRUD, attribution assign/group-move/unassign, composite-index queries | `portfolio-allocation-586-roundtrip.ts` (needs ADC) |
| #637 — SHARED lifecycle-tree contract | [dev-tools-lifecycle-contracts-637.md](dev-tools-lifecycle-contracts-637.md) | TOPICS-INVENTORY parse → buildTree → orderTopics sections | `dev-tools-lifecycle-contracts-637.ts` (no credentials) |
| #639 — BE lifecycle fetch shell | [dev-tools-gh-lifecycle-639.md](dev-tools-gh-lifecycle-639.md) | real GitHub BFS: search → batched nodes → subIssues pagination → status decode → inventory doc → sections | `dev-tools-gh-lifecycle-639-fetch.ts` (needs `GITHUB_READ_TOKEN` or `gh auth`) |
| #640 — BE getLifecycleTree callable | [dev-tools-gh-lifecycle-640.md](dev-tools-gh-lifecycle-640.md) | handler + real deps → response shape, grouping, error mapping | `dev-tools-gh-lifecycle-640-callable.ts` (needs `GITHUB_READ_TOKEN` or `gh auth`) |
| #647 — SHARED workflow template | [workflows-template-647.md](workflows-template-647.md) | conventions doc structure + optional workflow-doc conformance | `workflows-template-647.ts` (no credentials) |
| #681 — BE RH-MCP probe manifest | [rh-mcp-manifest-681.md](rh-mcp-manifest-681.md) | manifest file → loader → catalog validate → gate checks → dry-run plan | `functions/scripts/verify/rh-mcp-manifest-681.ts` (no credentials; runs from `functions/`) |
| #682 — BE catalog drift check | [rh-mcp-drift-682.md](rh-mcp-drift-682.md) | diff logic offline; live run via `run-drift-check.ts` → captures/00-drift.json | `functions/scripts/verify/rh-mcp-drift-682.ts` (offline) + live `run-drift-check.ts` (needs RH MCP) |
| #683 — BE probe manifest runner | [rh-mcp-runner-683.md](rh-mcp-runner-683.md) | runner core offline (mocked caller/prompt) over the real manifest; live run via `run-probe-manifest.ts` | `functions/scripts/verify/rh-mcp-runner-683.ts` (offline) + live `run-probe-manifest.ts` (needs RH MCP; mutations prompt) |
| #804 — BE KMS credential repository | [rh-mcp-kms-repository-804.md](rh-mcp-kms-repository-804.md) | KMS encrypt/decrypt → Firestore ciphertext doc → CAS revision guard → load round-trip → delete | `functions/scripts/verify/rh-mcp-kms-repository-804.ts` (needs ADC + `RH_CREDENTIAL_KEY_NAME`; runs from `functions/`) |
| #806 — BE credential upload + seed | [rh-mcp-upload-806.md](rh-mcp-upload-806.md) | bundle file → parse → KMS+Firestore seed → reload round-trip → seed refusal → replace CAS → delete | `functions/scripts/verify/rh-mcp-upload-806.ts` (needs ADC + `RH_CREDENTIAL_KEY_NAME`; runs from `functions/`) — real seed via `functions/scripts/upload-rh-credential.ts` |
| #807 — BE rhApi cloud function | [rh-mcp-cloud-api-807.md](rh-mcp-cloud-api-807.md) | deployed function auth gate → shared dispatch → KMS repo → MCP execute → reauth state | `functions/scripts/verify/rh-mcp-cloud-api-807.ts` (unauth checks standalone; `--token <idToken>` for the owner path) |
| #808 — BE MCP session cache + minInstances | [rh-mcp-session-cache-808.md](rh-mcp-session-cache-808.md) | deployed function config (minInstances/concurrency) → auth gate → timed sequential calls for warm-session latency; reuse proven by unit suite + `rh_mcp_session` logs | `tests/functions/rh-agent-mcp-session-cache.test.ts` (unit) + `functions/scripts/verify/rh-mcp-session-cache-808.ts` (unauth checks standalone; `--token <idToken>` for the owner path) |
| #916 — SHARED auto-paper contracts | [paper-trading-auto-paper-916.md](paper-trading-auto-paper-916.md) | signal desc/dedupe keys + stats scope ids + AUTO_PAPER_USER_ID; prod-read of run-ids/symbols/symbol-lists inputs | `paper-trading-auto-paper-916-contracts.ts` (no credentials) + `functions/scripts/verify/paper-trading-auto-paper-916-inputs.ts` (needs ADC; runs from `functions/`) |
| #917 — BE auto-paper enqueue + gates | [paper-trading-auto-paper-917.md](paper-trading-auto-paper-917.md) | exactly-once run-completion enqueue; task registration; config/live-date gates; `'*'` global capture | `tests/functions/st-run-completion.test.ts` + `auto-paper-ingest-pass.test.ts` (unit) + `functions/scripts/verify/paper-trading-auto-paper-917-gates.ts` (needs ADC; runs from `functions/`) |
| #887 — FE updateEquityStopOrder primitive | (UAT doc: `docs/topics/219-portfolio/219-925-887-UAT-PORTFOLIO-portfolio-dashboard.md`) | real cancel→confirm-poll→place against a live stop; resolves wire questions (terminal order_id lookup, sync place state) | `portfolio-update-stop-887.ts <accountNumber> <orderId> <newStopPrice>` (needs local observation API on :3456 — `npm start`) |

## Run All

```bash
npx tsx scripts/verify/run-all.ts [accountNumber]
```

Runs every verification script in documented order and reports a pass/fail summary. Scripts that need the account number are skipped (reported as SKIPPED) when it isn't supplied; credential-free scripts always run.

## Conventions

- Scripts live in `scripts/verify/` with naming `{domain}-{task-slug}-{stage}.{ext}`.
- Per-task guides: `scripts/verify/{domain}-{task-slug}.md`.
- Runner: `scripts/verify/run-all.ts` — single invocation for all scripts.
- Never wired into `npm test` or CI — these hit prod directly.
