# options-auth-guard-1437 — live auth-guard sweep (task #1437)

Verifies the four public-invoker options callables reject anonymous
callers **before** any validation or billed work, and that a properly
authenticated request reaches the handler (surfacing `invalid-argument`
on deliberately malformed input — no side effects).

## Prerequisites

- A `firebase deploy --only functions` **containing the #1437 guards** —
  pre-deploy, `optionsReplayStart`/`optionsReplayRetry`/`optionsAnalysisStart`
  return `invalid-argument` to anonymous calls and this script FAILs by
  design.
- ADC (`gcloud auth application-default`) with `serviceAccountTokenCreator`
  on `145446780542-compute@developer.gserviceaccount.com` — the same
  impersonation pattern as `backfill-orphan-st-symbols.ts`.
- `NODE_OPTIONS="--require C:/Users/bob/.config/node/ipv4-only.cjs"`
  (AT&T IPv6 workaround).

## Usage

```
cd functions
npx tsx scripts/verify/options-auth-guard-1437.ts
```

No arguments. Probes each of `optionsReplayStart`, `optionsReplayRetry`,
`optionsAnalysisStart`, `optionsReplayDelete` three ways:

| Probe | Expected |
|---|---|
| No `Authorization` header | `401 UNAUTHENTICATED` |
| `Bearer garbage-token` | `401 UNAUTHENTICATED` |
| Minted ID token + malformed input | `400 INVALID_ARGUMENT` |

The authed probe's inputs are chosen to fail validation *without* side
effects — no run docs, list docs, or task enqueues are created.

## Passing output

`PASS` lines for all 12 probes, ending `=== ALL PASS ===`, exit 0.

## Failing output

Any `FAIL` line means the guard is missing (anonymous →
`invalid-argument`/`internal` instead of `unauthenticated`) or over-
rejects (authed call → `unauthenticated`). Exit 1.

## Cleanup

The script creates a disposable Firebase Auth user
(`qa-1437-auth-guard`) via custom-token mint and deletes it on exit —
no residue unless the process is killed mid-run (harmless either way;
the user holds no data).
