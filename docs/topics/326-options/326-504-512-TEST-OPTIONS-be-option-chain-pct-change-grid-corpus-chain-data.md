**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Corpus-backed chain data
**Thread Slug:** corpus-chain-data<br>
**Issue:** #512  
**Thread Parent:** #504
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Area:** BE  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

---

# BE TEST: Error-code plumbing

## Unit — callable error mapping

- Partner error with `OPTIONS_NOT_ENABLED` body code → callable throws
  `failed-precondition` with the partner code preserved in the message.
- Partner 404 without the code → still `not-found` (unchanged behavior).
- 429 / 5xx mappings unchanged.

## Unit — proxy pass-through

- `callPartnerHistoricalOptions` response including `source` field →
  returned verbatim (already true — regression test pinning it).

## Integration (manual, post-SA)

- Against the real endpoint once SA ships: enabled symbol + corpus date →
  `source: "gcs"`; non-enabled symbol → the specified error signal.
