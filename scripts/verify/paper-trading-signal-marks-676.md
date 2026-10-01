# Verify guide — #676 BE signal-trade mark coverage

Verifies that `runSignalMarkPass` marks real OPEN signal-source trades
with live RH quotes — the path that lets a governing `trailing-{pct}`
stop actually fire on signal trades.

## Script

| Script | Covers | Credentials |
|---|---|---|
| `paper-trading-signal-marks-676.ts` | enumerate OPEN signal-source trades → real `runSignalMarkPass` (option legs via `get_option_quotes`, share legs via `get_equity_quotes` through the local RH MCP API) → assert `marks[ptDate].mark` + `lastMark` landed → eval-eligibility readout | ADC + local RH MCP OAuth (via `executeObservationTool`, same as -667) |

## Usage

```powershell
cd functions
npx tsx scripts/verify/paper-trading-signal-marks-676.ts
```

**Pass:** all checks `OK`, `marked=N` where N = OPEN signal-trade count
(11 at first run, 15 on the review-round re-run), exit 0.
**Fail:** missing marks or pass errors print detail; exit 1.

## Notes

- **This writes real marks on real signal trades** — intentional; marks
  are exactly what the nightly pass writes. No scratch docs, no cleanup.
- Safe to re-run: same-day marks overwrite by date key.
- Mark dates normalize to the PT market date (`normalizeMarketDate`), so
  a post-UTC-midnight run still lands on the right eval key.
- Composes with `-669` (seed/cancel/close seam) — that script's audit
  checks `marks` map integrity; this one proves marks actually arrive.
