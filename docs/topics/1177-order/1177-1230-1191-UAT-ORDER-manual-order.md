**Topic:** Manual Order Entry  
**Topic Slug:** manual-order  
**Thread:** Header Order Ticket  
**Thread Slug:** header-order-ticket  
**Issue:** #1230  
**Thread Parent:** #1178  
**Topic Parent:** #1177  
**Task:** #1191  
**Domain:** ORDER  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-23  
**Last Updated:** 2026-10-26  

# UAT — #1191 Header New Order button + core wiring

## Results log

| # | Scenario | Expected | Actual | Result |
|---|----------|----------|--------|--------|
| S1 | Signed-out: header renders | No New Order button anywhere in `rs-header` | | PASS — user-verified |
| S2 | Signed in, any route | Stroked add-icon "New Order" button in the header | | PASS — user-verified |
| S3 | Click New Order | Gallery ticket dialog opens in manual mode — symbol input + Resolve button, no tabs yet | | PASS — user-verified |
| S4 | Type `AAPL` → Resolve | STAGED `MAN-` equity ticket binds; Stock + Option tabs render on AAPL | | PASS — user-verified |
| S5 | Edit input to `MSFT` → Resolve (while AAPL still STAGED) | Input was never locked; session-created AAPL ticket is discarded; MSFT ticket binds | | PASS — user-verified |
| S6 | Re-resolve the same symbol with an option leg configured | Pure adoption — the bound option ticket is NOT released or unbound | | PASS — spec-covered (dialog spec, regression added in review) |
| S7 | Submit the bound ticket | Entry row locks ("Order in flight" hint) during SUBMITTING; confirmation panel on success | | PASS — user-verified |
| S8 | Close dialog mid-STAGED | Session-created STAGED tickets are discarded — no MANUAL stragglers in `st-order-tickets` | | PASS — user-verified |
| S9 | Open dialog, resolve AAPL, swap to MSFT while an AAPL option stage is in flight | AAPL option emit does not bind to the MSFT-bound dialog (ghost is tracked for cleanup) | | PASS — spec-covered (opt-ghost regression spec) |

## Notes

- User UAT pass reported PASS in-session (2026-10-26); S6 and S9 are
  timing-sensitive paths recorded as spec-covered per the user's call —
  matching the #1190 UAT precedent.
- Automated evidence: focused suites 104/104; full suite 259/259
  (4467 tests); `tsc --noEmit -p tsconfig.app.json` clean.
- Code review: `1177-1184-1191-CODE-REVIEW-ORDER-manual-order.md` —
  PASS, three convergent rounds.
