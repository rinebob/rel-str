**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1572  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Task:** #1576  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# CODE REVIEW — #1576 BE: Ledger ops — deletePaperTrades cascade + ingest curated dims + PRIMARY/SECONDARY widening

Three-axis gate review of the ledger-ops task: `deleteTradeCascade`
repository seam (txn delete + best-effort `rq-*`/`pap_*` cleanup),
the `deletePaperTrades` callable (auth → cap-50 → per-item
`deleted`/`notFound`/`failed`), the live-ingest dims swap to the
curated variant set + `governingPolicy` marker, the SECONDARY config
verification, 20 new specs, and the 36-check verify script + registry.

## Verdict: PASS (after in-gate remediation of 2 majors)

## Standards

Clean — no criticals/majors. Contract conformance verified exactly:
`DeletePaperTradesRequest/Response` + cap-50 in
`shared/paper-trading-contracts.ts`, `stTicketId('paper', id)` →
`pap_{tradeId}` matching both mint paths' `idSeed`, ingest dims
byte-identical to the #1575 mint seed (`DEFAULT_TRAILING_STOP_KEY` +
`CURATED_GOVERNING_POLICY` + `CURATED_VARIANT_KEYS`). Atomicity model
documented and correct: signal-scope refusal inside the txn; rq+ticket
cleanup in one post-commit best-effort batch. Fake-db spec harness
faithfully mirrors the admin-SDK surface the seam uses. Minors fixed
in-gate: prod-deps factory extracted (`deletePaperTradesProdDeps`),
over-cap check pins `DELETE_PAPER_TRADES_MAX_ITEMS + 1`, sibling
comment restored, loose nits (import order, request-type duplication)
recorded not fixed.

## Spec

All four acceptance criteria **MET**: (1) callable + cascade artifacts
+ idempotency; (2) curated dims on live captures, `SIGNAL_*` retained
on `callables.ts`/`expression-fill-pass.ts`; (3) SECONDARY verified in
prod `st-config/autoPaper` (`["PRIMARY","SECONDARY","MONITOR","NEW"]`);
(4) all TEST-doc bullets spec-pinned incl. the unchanged live-date
gate. Coverage map complete — every bullet traces to a named spec or
verify check.

## Thermo-nuclear — findings and remediation

### Fixed in-gate (2 majors)

1. **Accept-flow zombie-mint** — the `source !== SIGNAL` refuse gate
   was wider than the cleanup coverage: `paperSignalOrder` accepts
   stamp SIGNAL on trades whose staged member tickets live on
   cohort/group docs. Deleting an accept equity trade left member
   `pap_{seed}` tickets minting real trades into a dangling cohort —
   the worst silent outcome. **Fix:** the txn now refuses any trade
   carrying `cohortId`/`positionGroupId`/`ticket` (`'accept-flow'` →
   per-item `failed`); curated/auto-ingest trades carry none of the
   markers. The `trade.ticket.ticketId` cleanup branch became dead
   under the gate and was removed — cleanup is `pap_{tradeId}` only.
2. **Permanent account drift** — `acct-*` counters are
   ledger-incremental and nothing recomputes them; the contract's
   "stats passes recompute" claim was wrong for the account doc.
   **Fix:** the txn rewinds `openTradeCount` for lifecycle-open
   deletes (`LIFECYCLE_OPEN_TRADE_STATUSES`, `Math.max(0, n-1)` —
   the house decrement convention). Cash/equity/realizedPnl stay
   unwound as documented groom drift (reversing them needs the
   fill-accounting model); contract comment + seam docstring + IMPL
   as-built corrected to say exactly what is and isn't rewound.

### Documented, not fixed (minors/nits)

- ~ms window between txn commit and the cleanup batch where a same-id
  re-mint could lose its fresh ticket/rq doc — narrow (sequential
  per-id handler, single-user groom tool), noted in IMPL as-built.
- `pap_*` deletes are id-unverified; `pap_{tradeId}` cannot collide
  with another trade's ticket (expression seeds carry spread descs,
  never `EQ`-shaped ids — verified).
- Auth asymmetry: `auth.uid`-only vs `closePaperTrade`'s ownership
  check — deliberate groom-tool parity with the mint sibling.
- Batch 500-op cap unreachable in practice (~2yr of daily marks).
- Spec fidelity nits (fake txn modeling, non-signal-inside-txn proof
  shape) — assertions verified non-vacuous.

## Test gate

- `test:paper-trading` **398/398** (20 new delete specs: cascade
  artifacts, 3 accept-flow refuse markers, account rewind,
  missing-acct tolerance, best-effort, validation, dedupe, buckets)
- `test:st-order-tickets` 26/26 · `test:st-signals` 34/34 · tsc clean
- `verify paper-trading-ledger-ops-1576` **36/36**

## Flags for ship

- `index.ts` carries a foreign uncommitted hunk (`getStrategyEquityCurve`
  removal — #1564 session); stage the `deletePaperTrades` export hunk only.
- Prod `autoPaper.lists` was `["PRIMARY","SECONDARY","MONITOR","NEW"]` —
  broader than the task's SECONDARY ask; user confirmed unintended,
  **trimmed to `["PRIMARY","SECONDARY"]`** on 2026-11-18.
