**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Workflow Foundation  
**Thread Slug:** foundation  
**Issue:** #646  
**Thread Parent:** #626  
**Topic Parent:** #625  
**Task:** #648  
**Domain:** WORKFLOWS  
**Type:** Run-Sheet  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-10-11  

# Daily / Weekly Checklist

The doc opened at session start. Work top to bottom; triggered sections run only when they fire. Tags: `(manual)` = no app surface yet, do it by hand; `(external)` = happens outside this app.

## Every session — in order

- [ ] Portfolio pass — `/portfolio` (Portfolio ▸ Portfolio Dashboard): open positions, exposure, anything needing action today (~5 min)
- [ ] Signal review — `/signals/review` (Signals ▸ Signal Review): ~150–200 raw signals → watch list → timeframe → direction → ~5–15 candidates; per candidate decide **live / paper / decline** (~20 min)
- [ ] Triggered work — work whatever the section below has queued; skip empty slots, don't manufacture work

Short day? A triggered slot holding a **live candidate** (approved, awaiting order placement) outranks routine review — place pending orders first.

## Triggered — run only when it fires

- [ ] Order placement — fires when signal review flags order candidates — `/trading/live` (Trading ▸ Live) (~15 min)
- [ ] Position selection (manual — implicit today: default to shares or long calls inside order placement; a real position-builder surface comes later) (~15 min)

## Weekly — pick a session

- [ ] Strategy analysis (~60 min)
- [ ] Results review (~30 min)
- [ ] Review RS Momentum App for new symbols (external)

## Per-candidate drill-down

Checklists per position type — fills in as each strategy ships. Today most candidates default to shares or long calls inside order placement.

### Long stock
### Vertical debit
### Calendar
### Short put
### Synthetic long

## Parking lot

Stray thoughts at session start or mid-workflow go here — capture them, act on them after the day's work, not during.
