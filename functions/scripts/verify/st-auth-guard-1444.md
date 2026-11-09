# st-auth-guard-1444 — live auth-guard sweep (task #1444)

Sibling of `options-auth-guard-1437` for the five public-invoker
`st-cloud-function` callables: verifies they reject anonymous callers
**before** any validation or billed work, and that a properly
authenticated request reaches the handler.

## Prerequisites

- A `firebase deploy --only functions` **containing the #1444 guards** —
  pre-deploy, all five accept anonymous calls and this script FAILs by
  design.
- ADC (`gcloud auth application-default`) with `serviceAccountTokenCreator`
  on `145446780542-compute@developer.gserviceaccount.com` — the same
  impersonation pattern as `backfill-orphan-st-symbols.ts`.
- `NODE_OPTIONS="--require C:/Users/bob/.config/node/ipv4-only.cjs"`
  (AT&T IPv6 workaround).

## Usage

```
cd functions
npx tsx scripts/verify/st-auth-guard-1444.ts
```

No arguments. Probes each of `stGetSymbolsWithSignals`,
`stGetSymbolSignalHistory`, `stBacktestStrategies`, `stBacktestStart`,
`stOverviewSyncAdmin` three ways:

| Probe | Expected |
|---|---|
| No `Authorization` header | `401 UNAUTHENTICATED` |
| `Bearer garbage-token` | `401 UNAUTHENTICATED` |
| Minted ID token | per-callable (below) |

Authed-leg expectations:

| Callable | Input | Expected | Side effects |
|---|---|---|---|
| `stGetSymbolsWithSignals` | `{}` | `400 INVALID_ARGUMENT` | none |
| `stGetSymbolSignalHistory` | `{}` | `400 INVALID_ARGUMENT` | none |
| `stBacktestStrategies` | `{}` | `200` | none — read-only |
| `stBacktestStart` | `{symbols:[]}` | `400 INVALID_ARGUMENT` | none — dies before the run doc |
| `stOverviewSyncAdmin` | `{symbols:['__QA_PROBE_NOEXIST_1444__']}` | `200` | **one** Cloud Task for a bogus symbol — the partner lookup 404s and the worker returns early (bounded, worst case a retry). Every other input shape either validates the same way or triggers a *full* backfill, so this is the smallest possible effect. |

## Passing output

`PASS` lines for all 15 probes, ending `=== ALL PASS ===`, exit 0.

## Failing output

Any `FAIL` line means a guard is missing (anonymous → `invalid-argument`/
`internal`/200 instead of `unauthenticated`) or over-rejects (authed
call → `unauthenticated`). Exit 1.

## Cleanup

The script creates a disposable Firebase Auth user
(`qa-1444-auth-guard`) via custom-token mint and deletes it in
`finally` — no residue unless the process is killed mid-run (harmless
either way; the user holds no data). The single overview-sync task for
`__QA_PROBE_NOEXIST_1444__` hits the partner API once: a nonexistent
symbol should 404 → `fetchAndWriteSymbolOverview` returns early
(`st-overview-helper.ts`). Edge case: if the partner instead returned
`{ok:true, data:{}}`, the helper would write a stub doc containing only
`overviewFetchedAt` — still bounded (invisible to `enabled==true`
queries, one doc), but the zero-write guarantee isn't absolute.
Bounded at one task, `maxAttempts: 3` if the call itself errors.
