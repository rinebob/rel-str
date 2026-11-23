# 657-1671 Inquest — why the Robinhood grant kept dying

**Topic:** Robinhood MCP  
**Topic Slug:** rh-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #1671  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #1658  
**Domain:** RH-MCP  
**Type:** POSTMORTEM  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

## What happened

Over a few days in mid-November the production Robinhood connection
died repeatedly — `REAUTHORIZATION_REQUIRED` from the credential path,
the canary flagging a dead grant, manual re-auths. Everything had been
fine until then, which is part of why it took a while to see: each
incident looked like routine re-login housekeeping, not a pattern.

It turned out to be three independent failure mechanisms, fixed across
two tasks (#1639, then #1658).

**The mechanic that drives the whole story:** a Robinhood OAuth grant
stays alive by *rotating* its refresh token — the app periodically
exchanges the current token for a new one, and **each exchange burns
the old token**. Presenting a stale token gets `invalid_grant`, and
insisting with one risks revoking the grant outright. So any place a
stale copy of the token exists is a kill waiting to happen.

## The three failure mechanisms

**F1 — the rotated token only lived in process memory (fixed by
#1639).** When an instance refreshed, the new token stayed in that
process's memory/env bundle. The next cold start re-read the *old*
stored token — already burned — presented it, and the grant died.
Fixed by persisting every rotation to Firestore
(`rh-agent-credentials/bundle`, KMS-encrypted) with a revision counter.

**F2 — two instances raced to spend the same token (this fix).** With
the token now durable, two deployed instances near expiry could both
`load()` the same document, both see token *T*, and both POST it.
First wins and persists *T'*; the second's POST presents the now-dead
*T* → `invalid_grant`.

The subtlety: the doc already had CAS on the write — compare-and-swap
protected *persistence*, so two writes couldn't clobber each other.
But the race was lost earlier, at the *OAuth POST* — both requests had
already gone out before anyone checked anything. The fix wraps a
lease around the whole critical section (`load → re-check → POST →
CAS write → release`), and the loser doesn't retry with its stale
token — it reloads and adopts the winner's rotated bundle.

**F3 — we kept copying one live grant between stores (this fix).**
The bootstrap flow exported the local grant and uploaded it to prod —
two stores, one token lineage. Whichever side refreshed first burned
the other's copy; the burned side's next refresh presented a dead
token → same `invalid_grant` death, possibly revocation. No lock could
ever fix this — the copies live in different worlds (Windows DPAPI
file vs. Firestore) and can't see each other.

The fix makes the fork *explicit*: `upload-rh-credential` now seals —
it CAS-deletes the local copy after upload, but only when the local
and uploaded refresh tokens provably match (same lineage position).
Already-divergent local grants are independent lineages and left
alone. A `--replace` freshness guard blocks an older export from
overwriting a newer stored grant. And a live probe confirmed Robinhood
lets two *independent* grants coexist — which makes "one grant per
store, minted separately, never copied" the legal end state.

## Why it hid

- **Rotation destroys the evidence.** Every refresh overwrites the
  token that just died — post-incident you find a healthy-looking
  bundle or a bare `invalid_grant`, with no trace of which copy killed
  it.
- **Each death masqueraded as routine re-auth.** The pattern only
  became countable once the canary (a weekday-morning probe that
  exercises the real credential path) existed to flag every death on
  schedule.
- **The fork had a delay fuse.** Copying the grant to prod broke
  nothing that day — the kill fired days later on the *next* refresh,
  unrecognizable as upload-caused.
- **Robinhood documents none of it.** Rotation semantics, revocation,
  session limits, redirect-URI policy — no official docs. The model
  came from community evidence, then got verified experimentally.

## What the review rounds caught (5 total)

Worth listing because these are the bugs that only surface on
adversarial re-reading of concurrency code:

- **File-lease races of its own** — a crashed holder's lock could be
  stolen incorrectly, and a successor's live lock could be removed
  during takeover. Fixed with rename-aside + restore-or-orphan
  semantics.
- **Discarding the only good token** — after a successful POST, a CAS
  conflict made the code drop the freshly-minted token. Fixed: bounded
  retry — reload, and if the doc now holds a *different* refresh
  token, adopt it (it's the winner); if the doc was *deleted*
  mid-race, resurrect your minted token rather than discarding the
  only live copy.
- **Resurrection losing fields** — the first resurrect path wrote a
  tokens-only doc missing `clientInformation`/`discoveryState` — a
  bundle that couldn't refresh itself ever again.
- **Seal overclaiming** — a refresh could resurrect the local copy
  after the seal's delete committed; the seal now re-loads post-delete
  and reports `rotated_during_seal` instead of a false `sealed`.
- **Clock-skew grace** — a TTL check with 1ms-in-the-past fixtures was
  inside a new 1s skew window and un-takeable; verify fixtures moved
  to −5s.

Round 5 came back clean — no majors left.

## What the experiments proved (no docs exist)

`functions/scripts/verify/rh-oauth-design-probes-1658.ts`, run live:

- **`https://` redirect URIs are accepted** at dynamic client
  registration — an in-app "Connect Robinhood" flow in prod is
  mechanically possible. (Authorize-time acceptance is inferred, not
  yet proven — no prod callback exists to complete a login against.)
- **Independent grants coexist.** Two grants minted via two real
  logins + 2FA, then grant A refreshed cleanly *after* B existed.
  This is what legitimizes mint-per-store over copy-the-grant.
- Caveat: single-point evidence on an undocumented API. Strong, but
  not a contract — the canary remains the tripwire if RH behavior
  changes.

## Residual risks (accepted deliberately)

- **The lease bounds the race, it can't eliminate it.** A holder that
  stays alive past its TTL can be overtaken, and both processes could
  then POST inside the expiry window — Robinhood offers no fencing
  token, so no lease can fully fence the external call. Adopt-on-
  conflict is the safety net underneath.
- **"Stale retry → revocation" is inference.** Consistent with the
  observed deaths and standard `invalid_grant` semantics; unconfirmed
  by RH documentation, which doesn't exist.
- **An orphaned lease doc self-heals** via TTL takeover — verified
  live.

## Lessons

1. **A rotating token is a single-owner resource.** A second copy of
   the same token isn't redundancy — it's a fork that kills one side.
   Treat copies as managed migrations or forbidden, never "the same
   credentials in two places."
2. **Guard the side effect, not just the write.** CAS on the database
   write looked like concurrency safety, but the destructive race was
   upstream at the external API call. The critical section includes
   the network round-trip.
3. **On conflict, adopt — don't insist.** The right move after a
   successful POST + conflicting write is to reload and take the
   winner (or resurrect your own token if the doc is gone). Retrying
   with a stale token is how a recoverable race becomes a revoked
   grant.
4. **Mint per store; copy only as managed migration.** Confirmed end
   state: local and prod each own an independent grant minted through
   the same OAuth process — identical code, different storage (DPAPI
   vs. Firestore/KMS).
5. **Undocumented partner behavior needs experiments, not folklore.**
   Two short probes settled design questions no forum-reading could.
6. **A cheap scheduled probe exposes expensive invisible bugs.** The
   deaths looked routine until the canary made them countable.

## Still to do (under Thread #802)

- Prod in-app "Connect/Reconnect Robinhood" flow — HTTPS callback +
  transient pending-auth doc + admin gating + UI; feasibility proven
  by the redirect probe.
- Simplify the local file lease: a `refreshing` claim field inside the
  credential bundle under the existing store lock, retiring the
  hand-rolled lock-directory mechanism.
- Local re-auth affordance to match.

## References

- Ops playbook: `657-1671-RUNBOOK-RH-MCP-robinhood-mcp.md`
- Fix commits: `7bb6ca3c` (BE-BUG), `c3007da5` (BE-CHORE), `ca737742` (DOCS)
- Review: `657-802-1658-CODE-REVIEW-RH-MCP-robinhood-mcp.md` (r5 PASS)
- UAT: `657-1671-1658-UAT-RH-MCP-robinhood-mcp.md`
- Prior fix in the arc: #1639 — KMS/Firestore credential repository
- Domain term: CONTEXT.md → *Grant Lineage*
