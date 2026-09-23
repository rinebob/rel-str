**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Corpus-backed chain data
**Thread Slug:** corpus-chain-data<br>
**Issue:** #512  
**Thread Parent:** #504
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Area:** BE  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

---

# BE IMPL: Error-code plumbing + SA handoff spec

ST's callable layer is thin — `callPartnerHistoricalOptions` returns the
partner JSON verbatim and the callable maps `PartnerHttpError` status to a
callable code (404→`not-found`, 429→`resource-exhausted`, 5xx→`unavailable`).
`source` flows through automatically once SA populates it.

## Task A — SA corpus handoff spec (DOCS)

The deliverable of this thread — the document handed to SA specifying their
platform work. Contents:

- **Swing-set platform:** port ST's zigzag + swing-set generation; canonical
  registry = the 4 existing configs; generate swing files for every tracked
  symbol + on new-symbol add.
- **Symbol flags:** `optionable` (system-derived, probe-verified) +
  `optionsEnabled` (curated) on the symbol record; editable in symbol
  manager; enabling triggers corpus seeding.
- **Corpus:** existing GCS CSV-per-date infra unchanged; docs keyed
  `(symbol, date)`; pivot-date seeding per (symbol, config); one-time
  backfill of the enabled universe.
- **Endpoint contract:** `partnerHistoricalOptionsV2` shape unchanged;
  populate `source: "gcs" | "live"`; error contract — distinguishable
  signal for non-enabled symbol (proposed: body `code: "OPTIONS_NOT_ENABLED"`
  + HTTP 403/404) and for no-data-for-date vs transient failure.
- **Tracked/optionable universe endpoints** for consumers.

## Task B — Callable error mapping (BE-IMPL)

Once SA's error shape is specified in the handoff doc:

- If SA returns a body `code` (e.g. `OPTIONS_NOT_ENABLED`) alongside an HTTP
  status, map it to a dedicated callable code (`failed-precondition`) in the
  `PartnerHttpError` mapping in `options-contract.callables.ts` — so the FE
  distinguishes it from a generic 404 (which also means "no data for date").
- Pass the partner `code` through in the HttpsError message so the FE can
  branch on it reliably.

## Files

- `docs/topics/326-options/` — SA handoff spec doc
- `functions/src/options-contract.callables.ts` — error mapping
- `functions/src/options-contract-proxy.ts` — surface partner `code` on
  `PartnerHttpError` if needed
- `shared/options-contract-contracts.ts` — error-code constant/type if we
  introduce one
