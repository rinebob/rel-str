# How to Use `generate-historical-signal-history.ts`

## Purpose

Regenerate the `rh-agent-symbols/{symbol}/signal-history/{barDate}` Firestore docs from the `rs-bars` source data. The script uses the **exact same** `computeSymbolIndicatorSeries` engine as the chart callable, so the persisted signal list and the chart dots should always match.

## Location

```text
functions/scripts/generate-historical-signal-history.ts
```

Run all commands from the `functions/` directory:

```powershell
cd C:\aa\projects\rel-str\functions
```

## Prerequisites

- Firebase Application Default Credentials (ADC) set up locally.
- `tsx` is available in `functions/node_modules` (use `npx tsx`).
- The target symbol already has data in `rs-bars/{symbol}`.

## Common commands

### 1. Dry-run one symbol (safe — no writes)

Shows what **would** be written without touching Firestore.

```powershell
npx tsx scripts/generate-historical-signal-history.ts --dry-run --symbol AAPL
```

### 2. Dry-run with CSV output (for diffing against chart dots)

Prints one line per signal in `date,signalType,direction` format. This is the easiest way to compare the expected docs against the network-tab callable response.

```powershell
npx tsx scripts/generate-historical-signal-history.ts --dry-run --csv --symbol AAPL
```

### 3. Wipe out and regenerate one symbol

Deletes all existing `signal-history` docs for the symbol, then writes the new ones.

```powershell
npx tsx scripts/generate-historical-signal-history.ts --symbol AAPL --wipeout
```

### 4. Dry-run with wipeout (shows the full set after a simulated wipe)

Use this to verify the full output before running the live wipeout.

```powershell
npx tsx scripts/generate-historical-signal-history.ts --dry-run --csv --wipeout --symbol AAPL
```

### 5. Regenerate all symbols (not usually needed)

Omit `--symbol` to process every symbol in the tracked-symbols list. Use with extreme caution.

```powershell
npx tsx scripts/generate-historical-signal-history.ts --wipeout
```

## Flags

| Flag | Meaning |
|------|---------|
| `--dry-run` | Compute and print results but do **not** write or delete anything in Firestore. |
| `--csv` | With `--dry-run`, print one signal per line as `date,signalType,direction`. |
| `--wipeout` | Delete all existing `signal-history` docs for the symbol(s) before writing new ones. |
| `--overwrite` | Write even if a doc already exists for that date. |
| `--symbol SYM` | Only process `SYM`. If omitted, all tracked symbols are processed. |
| `--from YYYY-MM-DD` | Start date filter (default: `2019-01-01`). |
| `--to YYYY-MM-DD` | End date filter (default: today). |

## Important rules

1. **Always dry-run first.** Run `--dry-run --csv --wipeout` and compare to the chart dots before using `--wipeout` live.
2. ** `--wipeout` is destructive.** It deletes every `signal-history` doc for the symbol. There is no undo.
3. **Dry-run without `--wipeout` skips existing docs.** If you want to see the full output, include `--wipeout` in the dry-run.
4. **The script reads from `rs-bars/{symbol}`.** If the upstream bars are wrong (e.g., unadjusted weekly/monthly data), the signals will also be wrong. Fix the bars first.
5. **Do not run the live backfill for all symbols until the per-symbol dry-run is verified.**

## Verification checklist

After a live backfill:

1. Reload the RH Agent UI page.
2. Open the Agent Review or Grouped Review for the symbol.
3. Confirm the left-panel signal list matches the chart dots 1:1.
4. If they differ, compare the network-tab callable response to a new dry-run CSV.

## Troubleshooting

- **No signals written:** Check that `rs-bars/{symbol}` exists and has at least 30 daily bars.
- **Wrong dates:** Use `--from` and `--to` to narrow the range.
- **Chart dots do not match:** Verify the deployed `rhAgentGetSymbolIndicatorSeries` function is on the same code as local `computeSymbolIndicatorSeries`. If the local code changed, redeploy the functions before backfilling.
