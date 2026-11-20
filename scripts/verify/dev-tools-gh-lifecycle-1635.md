# Verify: dev-tools gh-lifecycle topic index (#1635)

Verifies `getLifecycleTopicIndex` — the lazy viewer's slim index callable —
end-to-end against real GitHub via the production dep wiring.

## Script

`dev-tools-gh-lifecycle-1635-index.ts`

- **Pipeline stage:** API response — `handleGetLifecycleTopicIndex` → real
  `ghLifecycleDeps` → real GitHub search + slim `nodes()` batch → shared
  transforms → `LifecycleTreeResponse` (roots with `children: []`).
- **Usage:**
  ```powershell
  $env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
  npx tsx scripts/verify/dev-tools-gh-lifecycle-1635-index.ts
  ```
- **Auth:** `GITHUB_READ_TOKEN` env var, else `gh auth token` fallback.
  Read-only — no mutations, no Firestore.
- **Pass:** all `PASS` lines + `ALL CHECKS PASSED` + exit 0.
- **Fail:** any `FAIL` line or non-zero exit. A nonzero `truncatedNodes`
  inside the handler surfaces as a thrown `internal` error (crash output).
- **Expected live result:** ~43 topic roots in ~2s (vs 30-60s for the
  monolithic `getLifecycleTree`), `groupOrder` carrying the
  TOPICS-INVENTORY sections, every topic `children: []`.

## What it covers

- Index fetch: roots found, `^Topic:` filter, metadata fields present
- Index contract: `children: []` on every root (no subIssues expansion)
- Grouping: `group`/`groupOrder`/`fetchedAt` parity with the monolith
- Status decode: at least one topic carries a project Status
- Validation: unsupported repo → `invalid-argument`, unauth → `unauthenticated`

## Notes

- Deliberately does NOT diff against the monolith response — that would
  cost a full corpus fetch (the thing this task exists to avoid).
  Structural equivalence is pinned by the unit specs instead.
