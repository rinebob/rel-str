# Verification Scripts

Permanent, on-demand scripts that verify BE pipeline stages against real behavior.
These are NOT part of the test suite — they are deliberate, manual invocations.

## Running

Run all verification scripts in order:
```
cd functions
npx tsx scripts/verify/run-all.ts
```

Run a single task's scripts:
```
cd functions
npx tsx scripts/verify/{script-name}.ts
```

## Index

| Task | Script | Pipeline stage | Guide |
|---|---|---|---|
| #257 | `strat-lib-257-compute.ts` | Return computation + metrics | [strat-lib-257.md](strat-lib-257.md) |
| #258 | `strat-lib-258-comparison.ts` | Script runner pipeline (Firestore → compute → JSON) | [strat-lib-258.md](strat-lib-258.md) |
| #268 | `indicator-lib-268-engine.ts` | Std Dev Lines engine (golden values + Firestore → compute → validate) | [indicator-lib-268.md](indicator-lib-268.md) |

## Order across tasks

1. **#257** — `strat-lib-257-compute.ts` (return computation module)
2. **#258** — `strat-lib-258-comparison.ts` (script runner pipeline)
3. **#268** — `indicator-lib-268-engine.ts` (std dev lines engine)
