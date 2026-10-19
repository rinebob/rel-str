**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1009  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# CODE-REVIEW — #1009 stop review-list + occurrence-decisions writes

## Summary

Retire the BE surface of `savant-trader/data/review-list` +
`savant-trader/data/occurrence-decisions`. The implementation sweep
established both collections are **FE-owned end-to-end** — the only BE
surface was two dead deprecated constants plus the TTL sweeper. The
changeset (~290 lines): constants deleted, a filesystem-scan guard spec
pins "no BE references", a prod verify script audits code-invariant +
sweeper registration + drain state, README marked retired. FE write-stop
and reader/UI removal remain #1016/#1017 scope by design.

Three axes ran in parallel. No criticals. One major (audit false-OK on
unparseable `decidedAt`) plus a batch of minors — all remediated
pre-verdict.

## Findings (all remediated)

### Major

1. **Audit green-lights NaN `decidedAt`** — `data-pipeline-decisions-retirement-1009.ts`.
   `new Date('')` or non-ISO `decidedAt` → `NaN > 9` false →
   `ok 'decision window NaNd … drain healthy'` AND `ok 'no fresh decision
   writes'` — the audit's exact worst failure mode on the anomalous input
   it exists to catch. **Fix:** missing-`decidedAt` docs counted + WARNed
   (also undrainable — invisible to the sweeper's `decidedAt<cutoff`
   query); unparseable range → FAIL, not OK.

### Minor

2. **Export regex false-passed on commented-out export** — anchored
   `^export \{` (m-flag) in both test and script; a commented export is
   exactly the "drain dead" state the check exists to catch.
3. **Stale `migrate-st-collections.js` could repopulate retired
   collections** — re-running writes back `occurrence-decisions` +
   `review-list`. Added do-not-run header; delete candidate at #1013.
4. **`probe-762-monitor.ts`** (untracked stray from #762) reads both
   retired collections — flagged for #1013 deletion, not committed under
   this task.
5. **Test comment overclaimed** — scan is `.ts`-only; `.md` files in src
   evade (README row intentionally keeps the literal). Comment rewritten;
   scan boundary documented as "deployed function code" in both files.
6. **`URL.pathname` hand-rolled** → repo idiom
   `dirname(fileURLToPath(import.meta.url))` (percent-encoding safe).
7. **Whitelist `endsWith` breadth** → leading-slash suffix so only the
   real sweeper path matches.
8. **README "no new writes" overclaim** — FE writes live until #1017;
   reworded "no BE reads/writes; FE writes stop at #1016/#1017".
9. **Verify script cwd footgun** — `walk('src')` from repo root would
   scan the Angular app; now resolves src from `import.meta.url`.

### Accepted nits (documented, not fixed)

- `in`-operator constant-absence specs are thin (any real consumer
  already fails tsc) — kept; cheap, and re-addition without a consumer
  is the case they guard.
- Cron literal pin (`'30 3 * * *'`) may die for an unrelated reschedule —
  house convention (trigger-path pins in #1007/#1008).
- 9-day drain threshold vs env-overridable `ST_DECISION_TTL_DAYS` —
  WARN-only; a raised TTL produces at most a spurious WARN.
- `test↔verify` ~15-line duplication — intentional (test runs cred-free,
  script needs ADC); both die together at #1013, noted in headers.

## Spec axis verdict

Both ACs **met on the BE axis**; the FE half is deferred to #1016/#1017
and documented everywhere (test header, script header, README, issue
comment on #1009). Review-list correctly has no sweeper (no TTL field —
dies wholesale at #1013). `firestore.rules`/`indexes` correctly left —
denying writes would break the live FE. Wider FE inventory posted for
#1016/#1017 coordination; #1013 checklist extended with rules/indexes/
stale scripts/this guard pair.

## Test results

- `test:decisions-retirement` — 5/5 (constants absent, src scan clean,
  sweeper registered + still on legacy path)
- `test:config-lists` — 20/20 (adjacent suite regression)
- tsc --noEmit clean; esbuild clean
- Prod audit: **0 FAIL, 0 WARN** — `occurrence-decisions` already fully
  drained (0 docs; FE organically stopped writing post-gallery),
  `review-list` at 12 docs until #1016

## Verdict

**PASS**
