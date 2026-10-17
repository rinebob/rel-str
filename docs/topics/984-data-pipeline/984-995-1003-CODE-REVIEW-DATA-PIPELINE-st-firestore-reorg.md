**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1003  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

# CODE REVIEW — BE-IMPL: order-intents dual-write + 77-doc migration + cutover (#1003)

## Change set

- `functions/src/order-tickets/legacy-order-intents.ts` — pure `legacyIntentToTicket` mapper (source→origin.type, `status:'paper'`→`mode:'paper'`, refId/lineage/tracking/terms preserved, malformed reporting, both-sized deterministic preference + warn, `settledState`/`settledFill` overrides) + `paperTradeStateSettle` + `suppressTerminalRegression` (terminal-wins incl. fill-beats-cancel).
- `functions/src/order-tickets/order-intents-mirror.ts` — `orderIntentsMirror` `onDocumentWritten` trigger (repo's first Firestore trigger): legacy write → canonical txn upsert (reads-before-writes; terminal suppression + opposite-prefix orphan delete in one txn); legacy delete → batched `liv_`/`pap_` delete; malformed/no-before events skipped; all fail-soft.
- `functions/scripts/migrate-order-intents-1003.ts` — one-shot migration: enumerate → map → paper-settle from the linked **equity** trade (top-level `ticket.refId`/`expression === 'EQ'`) → batch `set(merge)`; default dry-run (`--apply` to write, matching `migrate-options-strategy-to-paper.ts`), `--id` targeting, per-doc isolation, `orphans` tally, `nonEqOnly` warn, key-order-insensitive no-op detection, idempotent.
- `functions/src/paper-trading/callables.ts` — `getTicketDoc` canonical-first by `refId` + legacy fallback + doc-id last resort; `stTicketToOrderTicketDoc` adapter.
- `functions/src/screenshot-capture/tracking.ts` + `lifecycle-capture.ts` — intent carrier repointed to `st-order-tickets`, nested `tracking.*` fields; `mergeCapturedEventMaps` shared merge (top-level wins collisions); `carrierEventWritePayload` pure layout fn.
- `functions/scripts/verify/data-pipeline-st-order-tickets-migration-1003.ts` — parity audit (counterpart per mappable doc; refId/origin/state/terms/tracking/lineage).
- `functions/scripts/verify/paper-trading-signal-order-564.ts` — seeder → canonical `pap_verify-564-ticket`.
- `shared/st-order-tickets.ts` — `migratedFrom` marker (migration OR mirror provenance); fractional-quantity relax for non-option instruments (prod data carries fractional shares).
- Registrations: `functions/package.json` (`test:st-order-tickets` gains the migration spec), verify READMEs, `scripts/verify/run-all.ts`, `functions/tsconfig.json` (migration script added to typecheck scope), `#1002` audit WARNs on `migratedFrom` fill-gaps.

## Spec coverage (issue #1003 + IMPL-BE Phase 2 + TEST)

| Criterion | Status |
|---|---|
| "New writes hit both collections during soak" | **MET** — mirror trigger maps every legacy write into `st-order-tickets` (FE remains the sole legacy writer until #1015). |
| "77 docs migrated preserving refId/state/lineage; status:'paper'→mode:'paper'" | **MET (code)** — mapper + migration verified; prod dry-run: 90 docs (acceptance count is stale), 90/90 mappable, 0 malformed, 4 paper settles, 12 documented WARNs. Actual `--apply` run is the operator step. |
| "Readers cut over after verify; legacy writes stop" | **MET for BE; FE deferred by design** — `getTicketDoc` canonical-first, tracking repointed, no BE legacy writers remain. FE re-point + rules = #1015; collection removal = #1013. |
| TEST: "partially-filled intent states (`queued`, `paper`) — state mapping correct" | **MET** — status-map + settle specs pin both. |

## Review axes

### Standards — findings

| Finding | Severity | Resolution |
|---|---|---|
| Mirror upsert non-atomic — `get()` → suppress → `set(merge)` check-then-act outside a txn could clobber a racing `markFilled` (§6 atomicity) | **Major** | **Fixed** — `runTransaction` (reads-before-writes: ticket + opposite-prefix, then set + conditional delete); delete path batched |
| Dry-run convention inverted — wrote by default, `--dry-run` opt-out; sibling `migrate-options-strategy-to-paper.ts` defaults dry-run, requires `--apply` (§4) | **Major** | **Fixed** — `--apply` required to write; usage header + both READMEs updated |
| `legacy-order-intents.ts` 423 lines mixing pure mapping + Firestore I/O (§1) | Minor | **Fixed** — mirror handler + deps + path const moved to `order-intents-mirror.ts`; files now ~355/~126 |
| `Promise.all` of the two candidate deletes (§6) | Minor | **Fixed** — single `batch.commit()` |
| Duplicated nested+top-level `capturedEvents` merge in `readCapturedEvents` + `readCarrierEvents` | Minor | **Fixed** — `mergeCapturedEventMaps` in tracking.ts, reused by both |
| Opposite-prefix orphan logic duplicated mirror ⇄ migration | Minor | **Accepted** — different execution models (txn vs batch); both now existence-guarded; two call sites is not yet a helper |
| `readIntentTracking` `tracking ?? data` wholesale fallback inconsistent with the events merge | Minor | **Fixed** — per-field merge, top-level wins collisions (same doctrine as `mergeCapturedEventMaps`); docstring corrected (fallback serves pre-nesting canonical docs, not legacy-path docs) |
| `docPath.startsWith('st-order-tickets/')` string-sniff vs `LifecycleCarrier.kind` | Minor | **Accepted** — `kind` isn't threaded through the txn seam; the path prefix IS the contract. Extracted to pure `carrierEventWritePayload` so the branch is unit-covered |
| `SETTLED_PAPER_STATES` hardcodes settle codomain | Nit | **Accepted** — verify-script constant; a settle-side change would surface in mapper specs |
| Naming debt `intentDocPath`/`intentCarrier` post-cutover | Nit | **Accepted** — soak-era dual semantics; rename lands with #1013 removal |
| `as unknown` cast + `stats.unchanged--/updated++` fudge + dry-run "removed" wording | Nit | **Fixed** — cast removed; `orphans` tally; `would remove`/`removed` split by mode |

### Spec — findings

| Finding | Severity | Resolution |
|---|---|---|
| All three issue criteria + IMPL Phase 2 + TEST state-mapping cases accounted for | — | **MET** (table above); only unmet clause is the FE half of "legacy writes stop", deferred to #1015 by design |
| #1002-audit FAIL→WARN softening for `migratedFrom` docs edits a merged audit | Minor | **Accepted** — migration legitimately produces `filled` without fillSummary (11 prod docs never captured fillPrice); WARN preserves visibility |
| `validateStTicketTerms` fractional-quantity relax widens the writer gate for all equity emits | Minor | **Accepted** — required by real prod data (KMEM fractional close); option instruments keep integer rule |
| Parity audit `??` masked missing `signalContext.decisionId` — check could never FAIL | **Major** | **Fixed** — plain `!==` |
| Mirror `set(merge)` bypasses writer `ALLOWED_FROM` (terminal→terminal + non-terminal regressions pass) | Minor | **Accepted** — legacy is authoritative for non-terminal states during soak; terminal suppression guards the only direction that matters (documented doctrine) |
| `lifecycle-capture.spec.ts` used legacy `INTENT_DOC` path; nested write branch uncovered | Minor | **Fixed** — `carrierEventWritePayload` extracted + both branches specced; INTENT_DOC → `st-order-tickets/liv_intent-1` |
| `batch.commit()` failure attributes only to the in-flight doc; stats can over-report | Minor | **Accepted** — script is rerunnable; `unchanged` diff makes reruns honest |
| `stTicketToOrderTicketDoc` drops `dollarAmount` | Nit | **Accepted** — same exposure as the legacy `OrderTicketDoc` shape (parity) |
| `paper-trading-signal-order-564.md` documented legacy seed path | Nit | **Fixed** — now names `st-order-tickets/pap_verify-564-ticket` |
| `run-all` audit FAILs pre-migration | Nit | **Accepted** — by design; it's the post-`--apply` parity gate |

### Thermo-nuclear — findings

| Finding | Severity | Resolution |
|---|---|---|
| Terminal-wins guard non-atomic — the invariant it exists for could still be lost to a race (converged with Standards major) | **Major** | **Fixed** — transactional mirror (above) |
| `mappedDocEquals` `JSON.stringify` key-order false-negatives — `unchanged` could never fire; reruns rewrite identical docs | **Major** | **Fixed** — recursive `deepEqual` |
| `migratedFrom` stamped on soak-mirror docs though contract said "produced by the migration" | Minor | **Fixed** — docstring now covers both producers (migration + mirror) — provenance is "mapped from a legacy doc" |
| Mirror doesn't settle paper — soak-era rewrite of a closed paper intent stays `submitted` until migration rerun | Minor | **Accepted** — terminal suppression prevents regression; settle is a one-shot-migration concern; noted for operators |
| `pap_{intentId}` (mirror) vs `pap_{tradeId}` (#1002 emission) share `refId` during soak | — | ~~Accepted~~ → **re-opened in round 2, fixed** — see below |
| `getTicketDoc` three sequential reads | Nit | **Accepted** — soak-only; short-circuits on canonical hit |
| Test fake `where()` ignored its args (mock accepts anything) | Minor | **Fixed** — applies the field filter |
| Missing spec: mirror upsert inside txn ordering | — | **Fixed** — fake `runTransaction`/`batch` seams added; upsert/delete/orphan specs exercise the new paths |

## Round 2 — re-review of the post-remediation diff (2026-10-17)

Second pass over the remediated changeset. Two real majors found — both converged on by the Spec and Thermo-nuclear axes — plus moderate follow-ups. All remediated and re-verified.

### Round-2 findings

| Finding | Severity | Resolution |
|---|---|---|
| `loadTradeRefIndex` `Map.set` last-wins over cohort siblings — every paper cohort trade shares the ticket `refId`, so whichever trade iterated last determined the intent's settle state; an expression trade could override the equity trade | **Major** | **Fixed** — index prefers `dims.expression === EQUITY_TRADE_DESC` (the order's execution child); expression trades never win the slot |
| `getTicketDoc` `limit(1)` sibling collision — an emitted `pap_{tradeId}` expression ticket sharing the `refId` could be returned instead of the intent doc; its template `side`/`qty` would then fail `handlePaperSignalOrder`'s side check, breaking idempotent retries | **Major** | **Fixed** — fetch all canonical matches; prefer `migratedFrom === 'order-intents'` (soak shape), then the non-`expressionTemplate` ticket (post-cutover shape), then first match; two collision specs added |
| Parity audit FAILs on legal terminal-wins suppression — canonical `filled` vs mapped non-terminal is correct mirror behavior, not drift | Moderate | **Fixed** — suppression-shaped diffs report WARN, real drift still FAILs |
| Parity audit `JSON.stringify` tracking compare + term-by-term symbol/side checks | Moderate | **Fixed** — shared `deepEqual` moved to `legacy-order-intents.ts` (audit + migration consume it); whole-`terms` structural compare covers quantity/dollarAmount/instrument/orderType |
| Audit mappability predicate duplicated the mapper (status/source only — missed malformed `terms`) | Moderate | **Fixed** — audit now runs `legacyIntentToTicket` per doc and reports `mapped.malformed` reasons |
| `verify-564` cleanup deleted the seeded ticket but not emitted `pap_{tradeId}` tickets — leftovers would FAIL the parity audit as legacy-less canonical docs | Moderate | **Fixed** — cleanup deletes `pap_{tradeId}` per emitted trade |
| `validateStTicketTerms` integer rule skipped option tickets lacking `instrument` — pending-intent tickets carry `expressionTemplate` but no instrument tag | Moderate | **Fixed** — integer rule now fires on `instrument === 'option'` OR `expressionTemplate != null`; spec pinned |
| Fractional/unusable ticket quantity silently fell back to request quantity | Nit | **Fixed** — `logger.warn` on the fallback (uses the file's existing `createLogger`) |
| Mirror/migration could regress `updatedAt` — a legacy rewrite carries its own older stamp | Nit | **Fixed** — both keep `max(existing.updatedAt, mapped.updatedAt)`; mirror spec added |
| `event.params.intentId as string` redundant cast; `as unknown` tracking cast; `readCapturedEvents` inline merge | Nit | **Fixed** — cast dropped, per-field typed casts, shared `mergeCapturedEventMaps` |
| Merge-only mirror can't propagate FE `deleteField()` ops; mirrored-then-malformed docs leave the last-good canonical copy | — | **Accepted** — soak-window limitations documented in the mirror's header; the parity audit surfaces drift for review before #1013 removal |
| #1039 design-system rows (`scripts/verify/README.md`, `run-all.ts`, `angular.json`, `styles.scss`, `package*.json`) | — | **Out of scope** — user's working-tree edits for a different task; excluded from this review, left untouched |

## Round 3 — re-review of the post-round-2 diff (2026-10-17)

Third pass (Standards + Spec/adversarial axes on the scoped diff). One major — both axes converged — plus moderates/nits. All fixed and re-verified.

| Finding | Severity | Resolution |
|---|---|---|
| `loadTradeRefIndex` read `t.dims?.expression` — `dims` is the ledger **input** shape; stored `PaperTrade` docs spread `expression`/`ticket` **top-level** (ledger.ts:332-339, contract line 195). Every trade failed the EQ test → `byRef` empty → `paperSettled=0` → every paper intent would migrate `'submitted'`, masked by plausible "no EQ execution child" WARNs | **Major** | **Fixed** — typed read `Pick<PaperTrade, 'expression'|'ticket'|'status'|'fills'>`; top-level `t.expression !== EQUITY_TRADE_DESC` guard; `nonEqOnly` = refs with trades but no EQ child. Prod dry-run re-confirms `paperSettled=9` |
| `getTicketDoc` `docs[0]` fallback could return an expressionTemplate sibling and short-circuit a working legacy doc (emit is fail-soft — equity emit can be `null` while template emits succeed); non-template tier also admitted the emitted equity `pap_{tradeId}` ticket (`expression: 'EQ'`, no template) | Moderate | **Fixed** — pick chain: `migratedFrom` → doc with neither `terms.expression` nor `terms.expressionTemplate` (order docs never carry either; lifecycle tickets always do); if only lifecycle tickets remain, **falls through to legacy**. Spec added |
| Audit suppression tolerance missed `filled`-vs-mapped-`failed` — the mirror's `fillWins` doctrine covers any non-filled rewrite | Moderate | **Fixed** — `ticket.state === 'filled' && mapped !== 'filled'` (mirrors `suppressTerminalRegression` exactly) |
| Empty-date gating dropped a usable entry fill (price+qty present, date absent) | Minor | **Fixed** — `filledAt` falls back to legacy `updatedAt`/`createdAt`; still no empty-string |
| `updatedAt` compare could misbehave on non-string `existing` (Timestamp) | Nit | **Fixed** — both sides string-guarded (mirror + migration) |
| verify-564 cleanup left `st-screenshots` index docs + Storage artifacts from the wired lifecycle capture | Minor | **Fixed** — cleanup queries `st-screenshots` by `carrier.docPath` per trade id, deletes `svgPath`/`pngPath` objects (explicit bucket, per 826 pattern) + index docs |
| Mapper silently dropped `legs` when `instrumentType` ≠ `'option'` | Nit | **Fixed** — WARN added |
| Mirror txn fake didn't enforce the reads-before-writes contract it exists to test | Nit | **Fixed** — fake throws if `txn.get` follows a write |
| `callables.ts` ~930 lines | Nit | **Accepted** — reader cutover sits with the paper-signal deps it serves; an `order-ticket-lookup.ts` split is a candidate for the #1013 cleanup, not worth churn mid-soak |
| `t.terms?.expressionTemplate` termless-doc edge | Nit | **Fixed** — optional chaining; a termless doc can't be a template ticket |

### Round-3 test results

- `cd functions && npm run test:st-order-tickets` — **81/81** (new fall-through spec; txn fake now pins reads-before-writes)
- `cd functions && npm run test:paper-trading` — **236/236**
- `npx tsc --noEmit` — clean · `npm run build` — clean
- Prod migration dry-run **post-EQ-fix** — 90/90 mappable, `paperSettled=9` (confirming `t.expression` resolves the links), `nonEqOnly` empty, 0 malformed/failed

## Round 4 — regression-hunt pass on the remediation edits (2026-10-17)

Two axes re-ran with a narrowed brief: verify each round-1–3 fix against the real stored shapes/SDK contracts, hunting specifically for remediation-introduced regressions. **No majors.** Both axes independently confirmed the round-3 `t.expression` fix is correct (contract + ledger write sites) and the round-2 pick chain is sound.

| Finding | Severity | Resolution |
|---|---|---|
| Stale contract pin — `scripts/verify/data-pipeline-st-types-998.ts` still asserted `quantity: 1.5` throws without `instrument`; the #1003 relax makes that legal → spurious FAIL on next run | Minor | **Fixed** — pin updated (`0/-5/NaN` throw, fractional-without-instrument passes, fractional option still throws); script re-runs green |
| Pick chain + adapter admitted a canonical doc with `refId` but no `terms` → `stTicketToOrderTicketDoc` TypeError → `internal` not `not-found` (unreachable today — every refId writer stamps terms) | Nit | **Fixed** — discriminator requires `t.terms != null`; adapter uses optional chaining |
| Multiple EQ trades sharing a `ticket.refId` (concurrent-accept duplicate-cohort race) → settle picks deterministic-but-arbitrary | Nit | **Accepted** — best-effort settle; a rerun reconciles; the race is a documented known gap |
| **Latent**: audit's tracking-leaf equality will FAIL when canonical `tracking.lastSeenState`/`capturedEvents` legitimately advance past the legacy doc (detector-owned leaves); mirror merge could likewise regress canonical tracking leaves — same unguarded shape `updatedAt` had | Minor (latent) | **Accepted with note** — detector-facing tracking writers have zero production callers today (grep-verified); when the lifecycle detector wires in (#TBD tracking task), switch the audit to containment (legacy ⊆ canonical) and consider extending suppression doctrine to detector-owned leaves |

### Round-4 test results

- `cd functions && npm run test:st-order-tickets` — **81/81** · `npm run test:paper-trading` — **236/236**
- `npx tsx scripts/verify/data-pipeline-st-types-998.ts` — **all checks pass** (was going to spuriously FAIL on `1.5`)
- `npx tsc --noEmit` clean · `npm run build` clean

### Round-2 test results

- `cd functions && npm run test:st-order-tickets` — **80/80** (updatedAt non-regression + both collision specs)
- `cd functions && npm run test:paper-trading` — **236/236**
- `npx jest shared/st-order-tickets.spec.ts tests/functions/screenshot-capture/` — **184/184** (new expressionTemplate integer-gate spec)
- `cd functions && npx tsc --noEmit` — clean · `npm run build` — clean
- Prod migration dry-run — 90/90 mappable, `paperSettled=9` (prod trade set grew since round 1), `malformed=0`, `failed=0`
- Parity audit smoke-run (pre-`--apply`) — executes cleanly; 90 FAILs are all "no canonical counterpart", correct pre-migration

## Test results

- `cd functions && npm run test:st-order-tickets` — **77/77** (round 1; **80/80** after round-2 specs)
- `cd functions && npm run test:paper-trading` — **236/236**
- `npx jest tests/functions/screenshot-capture shared/st-order-tickets` — **184/184** (9 suites incl. new `carrierEventWritePayload` specs)
- `cd functions && npx tsc --noEmit` — clean (migration script now inside typecheck scope)
- `cd functions && npm run build` — esbuild clean (~1.9 MB)
- Prod migration dry-run (no flag = dry-run) — 90 docs, 90/90 mappable, `orphans=0`, `paperSettled=9`, `malformed=0`, `failed=0`
- **Full `npx jest`** — 3792 pass / 43 fail in 2 suites, **all pre-existing and unrelated** (failing files byte-identical to HEAD, untouched by this change): `shared/screenshot-capture-contracts.spec.ts` (stale `PositionType` assertion — enum grew option types in committed #942 work) + `order.component.spec.ts` (NG0201 `Functions` provider missing — committed `OrderExecutionService`→`ScreenshotService` injection predates this change). Logged for triage; not a #1003 regression.

## Verdict

**PASS** (confirmed after round 4 — convergence) — round 1 fixed the transactional mirror race, `--apply` convention, audit `??` mask, and key-order-stable no-op diff; round 2 fixed the settle-index equity preference, the `getTicketDoc` sibling collision, audit suppression tolerance, audit structural comparison, seeder cleanup completeness, and the `expressionTemplate` integer gate; round 3 caught and fixed the `dims`-vs-top-level `expression` settle bug (would have silently migrated every paper ticket as `submitted`), the lifecycle-ticket fall-through in `getTicketDoc`, and verify-564's screenshot-artifact leak; round 4 (regression-hunt brief, both axes verifying every remediation edit against real stored shapes/SDK contracts) found **no majors** — a stale verify-script pin and a termless-doc nit, both fixed — and documented one latent residual (tracking-leaf equality vs the unwired detector; fix when it wires). Remaining items are accepted residuals with documented owners (#1015 rules/FE cutover, #1013 removal). Ready for QA: `/proj qa 984 1003`.
