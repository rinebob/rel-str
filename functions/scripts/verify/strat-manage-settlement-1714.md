# strat-manage-settlement-1714 — position-grain settlement + held-shares (#1714)

Verifies the #1714 rewrite end-to-end against real Firestore with scratch
docs: position-grain sweep (no instance enumeration), zombie/no-instance
reachability, signal-source disjointness, last-leg/per-leg outcomes,
partial spread assignment → held shares, and the held-shares daily mark.

```bash
cd functions && npx tsx scripts/verify/strat-manage-settlement-1714.ts
```

**Env:** ADC with Firestore access (rel-str). No RH MCP needed — outcomes
compute locally from the SDS close; the brokerage checker is optional and
never wired in prod.

**What it seeds:** a scratch instance + account + five `verify-1714-*`
trade docs on real QQQM SDS bars (expiration `2026-09-29`):

- `verify-1714-zombie` — OPEN far-OTM short put, **no**
  `strategyInstanceId` (the `260819-*` zombie shape the instance-grain
  loop could never reach)
- `verify-1714-signal` — OPEN expired short put with `source=SIGNAL`
  (must be left untouched — `signalSettlementPass` owns it)
- `verify-1714-spread` — OPEN 2-leg put spread, close between the
  strikes (short assigns +shares at its strike, long expires worthless)
- `verify-1714-single` — OPEN expired far-OTM put on the instance
- `verify-1714-held` — ASSIGNED trade with a `shares` record (for the
  held-shares mark)

The injected `listOpenOptionTrades`/`listAssignedTrades` listers scope the
sweeps to the scratch docs — the production passes are global, so the
injection keeps the verify off real prod positions. The signal-source
filter lives inside the pass, so `verify-1714-signal` still proves
disjointness end-to-end.

**What it asserts:** zombie + single settle `EXPIRED` with premium
realized; signal doc stays `OPEN` with no leg outcome; spread settles
`ASSIGNED` with `shares {quantity:1, costBasis: short strike}` and per-leg
outcomes (short `ASSIGNED`, long `EXPIRED_WORTHLESS`); the held trade's
`marks[runDate]` carries its own symbol's close and P&L vs basis. The
script then reports OPEN-trade reachability (how many prod docs lack
`strategyInstanceId` — the real zombie-sweep candidates), cleans up every
scratch doc, and verifies deletion.

**Passing:** every check prints `OK` and the script exits 0
(`N passed, 0 failed`). Any `FAIL` prints the offending doc/detail and
exits 1. Scratch docs are deleted in a `finally` even on failure.
