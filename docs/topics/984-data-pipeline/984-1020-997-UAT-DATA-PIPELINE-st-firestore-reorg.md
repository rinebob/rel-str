**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1020  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #997  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# UAT — SHARED-IMPL: st- collection path constants (#997)

## Scope

Canonical `st-`-prefixed Firestore collection/document path constants and
path-helper functions, shared by BE (functions) and FE (Angular) through the
`@st/collections` tsconfig alias. Constants-only deliverable — no runtime
readers/writers changed; consumers arrive per-task (#1000+ BE, #1014+ FE).

Acceptance criteria covered (QA issue #1020 + task #997):

- `shared/st-collections.ts` exposes all new st- paths: 10 flat roots,
  2 anchored roots, st-runs `jobs` subcollection helpers, `st-config` status
  doc id.
- FE consumes via `@st/collections` (single shared source — IMPL's preferred
  option over literal FE mirrors); BE consumes via the same alias plus the
  `functions/src/common/st-collections.ts` re-export barrel.
- Firestore-legal segment parity: collection paths odd, document paths even.
- Legacy constants untouched (dual-write coexistence); legacy/new twins carry
  `@deprecated` successor markers.
- `instance`/`cohort` paper-trading kinds throw loudly (moved to
  st-strategy-instances / st-position-groups).

## Prerequisites

- Repo checkout on the working branch with the #997 change set applied.
- Node + npm deps installed (`npm i` at root and in `functions/` if needed).
- No Firebase credentials or running services required — everything is
  offline constants/helper verification.

## Start instructions

All commands run from the repository root `C:\aa\projects\rel-str`.

## Scenarios

### S1 — Unit spec suite (jest)

Confirms the pinned path values, kind sets, parity, guards, and drift pins.

```bash
npx jest shared/st-collections.spec.ts --coverage=false
```

Expected: `Tests: 18 passed, 18 total` — covers flat-root literals,
`ST_CONFIG_STATUS_DOC='status'`, `ST_JOBS_SUBCOLLECTION_NAME='jobs'`,
jobs-path builders incl. symbol uppercase normalization, all four
st-paper-trading anchors, instance/cohort throws, `Object.prototype`-name
throws, legacy-mirror drift pins, portfolio anchors + plural-name throw,
odd/even segment parity.

**Result:** PASS — 18/18 specs green.

### S2 — Offline verify script (tsx, exercises the real `@st/collections` alias)

```bash
npx tsx scripts/verify/data-pipeline-st-collections-997.ts
```

Expected: every check prints `OK`, ends with `=== ALL CHECKS PASSED ===`,
exit code 0. A passing run proves alias resolution under tsx (nearest
`tsconfig.json` = repo root, the same file that defines the FE alias) plus
the functions-barrel delegation `ST_JOBS_SUBCOLLECTION → 'jobs'`.

**Result:** PASS — all checks OK (68 checks), `ALL CHECKS PASSED`.

### S3 — Jest alias resolution probe

The shipped spec uses the sibling-convention relative import; this scenario
proves the `jest.config.js` `moduleNameMapper` entry `^@st/collections$`
resolves at runtime.

```bash
cat > shared/alias-probe.spec.ts <<'EOF'
import { ST_SIGNALS_ROOT } from '@st/collections';
it('alias resolves under jest', () => expect(ST_SIGNALS_ROOT).toBe('st-signals'));
EOF
npx jest shared/alias-probe.spec.ts --coverage=false
rm shared/alias-probe.spec.ts
```

Expected: 1/1 pass — the `@st/collections` specifier resolves under jest.

**Result:** PASS — 1/1 pass; probe file deleted after the run.

### S4 — Backend bundle build (esbuild through `functions/tsconfig.json` paths)

```bash
cd functions && npm run build
```

Expected: `lib\index.js  ~1.8mb` + `Done` — esbuild resolves `@st/collections`
into the functions bundle; the explicit re-export barrel compiles under
`noUnusedLocals`/`isolatedModules`.

**Result:** PASS — bundle built, no errors.

### S5 — Legacy coexistence / dual-write surface

Confirm legacy constants are intact and only marker-level edits were made:

```bash
git diff functions/src/common/st-collections.ts src/app/core/common/constants.ts | grep -E '^[+-]' | grep -v deprecated | grep -vE '^\+\+\+|^---'
```

Expected: the only `+` additions are `@deprecated` JSDoc, the shared
re-export block, the `ST_JOBS_SUBCOLLECTION` delegation, and new st- JSDoc —
no legacy path literal changed or removed. Additionally, S1's drift pins
(`st-${paperTradingItemsPath(kind)}`, `portfolio/` → `st-portfolio/` replace)
prove at runtime that new paths mirror the live legacy constants.

**Result:** PASS — no legacy literal touched; all edits are markers/exports.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `@st/collections` resolves in FE/BE/jest/tsx | S2 (tsx + root tsconfig), S3 (jest), S4 (BE esbuild) |
| All new st- paths exposed (flat + anchored kinds) | S1, S2 |
| Segment parity — collections odd / docs even | S1, S2 |
| FE constants mirror subset (via shared alias) | S2, S3 |
| Legacy constants untouched; coexistence | S1 (drift pins), S5 |
| instance/cohort reject loudly | S1, S2 |

## Regression / smoke checklist

- `src/app/core` + `shared/` jest sweep: 950/951 — sole failure the
  pre-existing `screenshot-capture-contracts` PositionType spec (committed
  drift from another workstream, untouched by this task).
- `scripts/verify/run-all.ts` registration: script registered, no
  credentials required.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface. Constants-only deliverable; no UI
was added, removed, or changed.

## Findings

None.
