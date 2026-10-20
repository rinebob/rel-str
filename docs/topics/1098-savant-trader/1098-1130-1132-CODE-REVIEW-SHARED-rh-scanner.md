**Topic:** Savant Trader  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1130  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1132  
**Domain:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-19  
**Last Updated:** 2026-10-19  

# Code Review — #1132: st-scanner paths + firestore.rules

## Verdict: PASS (two review rounds, converged)

### Round 2 sweep (per user request — new-findings-only)

Spec axis: **no new findings** — all criteria still met on final state.
Standards + thermo axes surfaced four items, all remediated:

- **nit (remediated):** relay section header retained a `(#1132)` task
  ref — same convention violation pass 1 removed from the spec describe.
  Dropped.
- **LOW (remediated):** companion guide
  `data-pipeline-st-collections-997.md` still described "both anchored
  domains" — now lists all three + the barrel probe + config helper.
- **LOW (remediated):** barrel-delegation probe covered only 1 of 5
  scanner exports while its label claimed "helpers" (plural). Now probes
  all four value exports (root, anchor, items path, doc path); the
  `StScannerKind` type can't be runtime-probed — its `export type`
  re-export is compile-checked by `tsc`.
- **nit (remediated):** `stConfigDocPath` was the one path helper the
  relay had never exercised — added 2 checks, making the script's
  "every canonical `st-` root and path helper" claim literally true.

Post-R2 verification: relay re-run → ALL CHECKS PASSED (now 14 scanner/
config checks); spec suite unchanged 21/21.

### Round 1

No critical or major findings. Two LOW thermo-nuclear findings and two
standards nits were remediated in-flight; all remaining items are
nit/accepted precedent-consistent trade-offs.

## In-scope files

- `shared/st-collections.ts` — `st-scanner` anchored-root block
- `shared/st-collections.spec.ts` — path/segment specs
- `firestore.rules` — `st-scanner/{anchor}/items/{docId}` match block
- `functions/src/common/st-collections.ts` — barrel re-export (added in
  review remediation)
- `scripts/verify/data-pipeline-st-collections-997.ts` — relay extended
  with scanner checks (added in review remediation)

## Axis summaries

### Standards — PASS (nits remediated)

- **nit (remediated):** file-header layout recap omitted `st-scanner`
  from anchored roots — added.
- **nit (remediated):** new describe carried a task ref `(#1132)`;
  sibling describes cite none — renamed to `'st-scanner anchored paths'`.
- **minor (accepted):** `StScannerKind` is an exported type with no
  consumer — IMPL §5 prescribes it verbatim; type-only, documented as the
  seam for future kinds. Kept; comment corrected (see thermo N1).
- **nit (accepted):** per-kind named helpers diverge structurally from
  sibling kind-parameterized helpers — deliberate YAGNI for a single
  kind; IMPL §5 prescribes this exact API.

### Spec — PASS (all criteria met literally)

- Path helpers, constants, and `StScannerKind` present at
  `st-collections.ts:191-213`, literal outputs verified:
  `st-scanner/proposals/items` / `st-scanner/proposals/items/{id}`.
- Rules block at `firestore.rules:466-469` is verbatim IMPL §6; anchor
  docs and deeper paths fall to the default deny — verified against the
  paper-trading precedent.
- Spec coverage in `st-collections.spec.ts` (the helpers' home) rather
  than `scanner-contracts.spec.ts` — the TEST doc explicitly invites
  sibling mirroring; all path/segment expectations covered.
- **Observation (remediated):** the functions barrel
  (`functions/src/common/st-collections.ts`) re-exports every canonical
  root's names but lacked the scanner set — added all five plus
  `StScannerKind` as a type export.

### Thermo-nuclear — PASS (both LOW findings remediated)

- **L1 (remediated):** functions barrel silently incomplete — the
  declared "re-export surface for canonical `st-` roots" now carries the
  five scanner names; a BE consumer will find them where convention
  promises.
- **L2 (remediated):** registered relay
  `data-pipeline-st-collections-997.ts` claimed to exercise "every
  canonical `st-` root and path helper" but didn't know `st-scanner`.
  Extended with 7 checks (root, anchor, both paths, segment parity,
  barrel delegation probe) — relay now reports ALL CHECKS PASSED.
- **N1 (remediated):** `StScannerKind` comment oversold ("extend the
  union rather than re-shaping the helpers" — but helpers are arity-0).
  Comment now states the honest reason: a pinned spelling for future
  kind-parameterized helpers.
- **N2–N4 (accepted, documented):** blanket authed read pre-grants
  future anchors (same shape as paper-trading; a future anchor task must
  *edit* this block); no nested-subcollection rule (proposals are flat);
  no field-level write validation (no `userId` on `CurationProposal`;
  single-user app).

## Attack vectors cleared

- Authed writes outside `proposals` → contained by `anchor == 'proposals'`
  gate; non-proposals paths fall to default deny.
- Anchor doc `st-scanner/proposals` → implicitly denied (depth mismatch),
  same as paper-trading precedent; `list`/`addDoc` under `items` work
  without parent-doc access.
- `stScannerProposalDocPath('')`/`'a/b'` → bare interpolation identical
  to every sibling helper; repo convention validates ids at construction
  (`st-ids.ts`), and proposals use `addDoc` auto-ids.

## Test evidence

- `npx jest shared/st-collections.spec.ts` — **21/21 pass** (3 new).
- `npx tsx scripts/verify/data-pipeline-st-collections-997.ts` —
  **ALL CHECKS PASSED** (7 scanner checks incl. barrel delegation).
- `cd functions && npm run typecheck` — **clean**.
- Root `tsc --noEmit` — zero st-collections/scanner diagnostics.
- Broader `shared/` suite — 42/43 suites; the one failure is the known
  unrelated `screenshot-capture-contracts.spec.ts` `PositionType` drift
  (concurrent options thread).
