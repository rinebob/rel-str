# Verify: SHARED GitHub native sub-issue retrofit (task #1524)

Exercises `scripts/retrofit-gh-subissues.ts` end-to-end against prod GitHub —
anchor enumeration → structural-section BFS → live-parentage diff → report —
plus persistence of the already-applied links and re-run idempotency.

## Scripts

| Script | Stage | Command |
|---|---|---|
| `dev-tools-retrofit-subissues-1524.ts` | dry-run pipeline + live-parentage spot-check + #137 link persistence + idempotency | `npx tsx scripts/verify/dev-tools-retrofit-subissues-1524.ts` |

## Usage

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx scripts/verify/dev-tools-retrofit-subissues-1524.ts
```

No arguments, no flags. Needs `gh` CLI authenticated. **Read-only** — it never
invokes `--apply`; it runs the retrofit's default dry-run and inspects the
report files it writes under `.devin/tmp/`.

## What it checks

- The dry-run completes for both `rinebob/rel-str` and `rinebob/av-proxy-api`
  (exit 0 or 2 — 2 means conflicts were reported, which is expected while
  unresolved conflicts exist).
- A fresh report JSON lands in `.devin/tmp/` per repo with every intended edge
  partitioned into proposed / alreadyCorrect / conflicts / blocked /
  unresolved.
- `proposed` is empty — all safe edges were applied during #1524. A non-zero
  proposed count means new unparented declarations appeared (or an apply
  regressed) and should be investigated.
- Three sampled `alreadyCorrect` edges match live GraphQL parentage — the diff
  reflects real state, not a stale read.
- #137's `subIssues` natively include #138, #141, #153, #155, #158 — the links
  this task applied.

## Pass / fail

- Pass: every check prints `PASS`, exits 0.
- Fail: any `FAILED` line, exits 1. Note that `gh` prints
  `Could not resolve to an Issue` warnings to stderr for dead body refs
  (e.g. #1/#6–#9 under #108) — these are expected and not failures.

## Notes

- The retrofit itself: `npx tsx scripts/retrofit-gh-subissues.ts
  [--repo owner/name]... [--only n[,n...]] [--apply]`. Dry-run is the default;
  `--apply` links proposed edges via `addSubIssue` (closed parents are
  transiently reopened). Conflicts and blocked-cycles are always report-only —
  the script never reparents.
- Reports persist in `.devin/tmp/retrofit-gh-subissues-{owner}-{repo}-{ts}.json`.
