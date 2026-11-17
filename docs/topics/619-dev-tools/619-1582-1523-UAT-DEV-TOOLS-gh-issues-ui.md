**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1582  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1523  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# UAT — #1523 SHARED: Label write contracts + system-label guard

Shared TypeScript contracts for the three label callables plus the
`isSystemLabel`/`SYSTEM_LABEL_PATTERNS` guard the FE picker hides and the
BE enforces. **No user-facing surface** — acceptance is at the module and
live-vocabulary level. The FE label editor (which consumes these
contracts) is FE Blueprint #1521, still pending.

## Scope

- `shared/lifecycle-labels.ts` — `RepoLabel`, `ListRepoLabelsRequest`,
  `ListRepoLabelsResponse`, `UpdateIssueLabelsRequest`,
  `UpdateIssueLabelsResponse`, `ManageRepoLabelOp`,
  `ManageRepoLabelRequest`, `ManageRepoLabelResponse`
- `isSystemLabel(name)` + `SYSTEM_LABEL_PATTERNS` + `STAGE_LABEL_PATTERN`
  + `STRUCTURAL_LABELS` + `CATEGORY_LABELS` + `DOMAIN_LABELS`
- `@lifecycle/labels` path alias in `tsconfig.json`,
  `functions/tsconfig.json`, `jest.config.js`
- Issue acceptance criteria:
  - Contracts + guard exported from `shared/lifecycle-labels.ts`
  - `isSystemLabel` spec: stage/structural/DOMAIN/Category names
    excluded; arbitrary names pass
  - Constant documented as manually synced with `project-config.json`

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`, working tree containing the
  uncommitted #1523 changes (`shared/lifecycle-labels.ts` exists).
- `gh` CLI authenticated to `github.com/rinebob` (read access —
  `gh auth status` shows an active token).
- Node 24 + repo `node_modules` installed (`npx tsx`, `npx jest` resolve).
- `NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"` —
  required for any command that hits the network (`gh` calls it
  internally; jest/tsx local runs do not need it).
- **No browser, dev server, or Firebase deploy needed** — this task is
  pure shared contracts; the running Angular server is irrelevant.

## Getting to the feature

- **Route:** none — no UI surface. This UAT is executed entirely at the
  command line from the repo root `C:\aa\projects\rel-str`.
- **Entry point:** the module `shared/lifecycle-labels.ts`; the import
  specifier `@lifecycle/labels` resolves to it in all three compile
  contexts.
- **Surface the tester lands on:** a terminal at the repo root running
  the commands below. Every command is verbatim — paste and run.

## Test scenarios

### S1 — Module exports + contract shapes (spec suite)

```bash
npx jest shared/lifecycle-labels.spec.ts --coverage=false
```

**Expected:** `Tests: 90 passed, 90 total`. The suite covers every
exported contract shape, the stage pattern, the guard exclusions
(stage/structural/Category/domain, case-insensitive), arbitrary passes,
and the pinned mirrored vocabulary.

**Result:** PASS — `Tests: 90 passed, 90 total`

### S2 — Live vocabulary audit (real repo labels vs the guard)

Classifies every real label on `rinebob/rel-str` through `isSystemLabel`
and asserts the split is exactly 61 system / 7 user labels.

Create the script (paste verbatim):

```bash
mkdir -p .devin/tmp && cat > .devin/tmp/uat-1523-guard-audit.ts <<'EOF'
import { execFileSync } from 'node:child_process';
import {
  isSystemLabel,
  SYSTEM_LABEL_PATTERNS,
} from '../../shared/lifecycle-labels';

const EXPECTED_USER = new Set([
  'documentation',
  'duplicate',
  'enhancement',
  'good first issue',
  'help wanted',
  'invalid',
  'question',
]);

const names: string[] = JSON.parse(
  execFileSync(
    'gh',
    ['label', 'list', '--repo', 'rinebob/rel-str', '--limit', '100', '--json', 'name'],
    { encoding: 'utf8' },
  ),
).map((l: { name: string }) => l.name);

const system: string[] = [];
const user: string[] = [];
for (const n of names) (isSystemLabel(n) ? system : user).push(n);

let fail = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) fail++;
};

console.log(`repo labels: ${names.length}`);
check(names.length === 68, `expected 68 labels, got ${names.length}`);
check(system.length === 61, `expected 61 system labels, got ${system.length}`);
check(user.length === 7, `expected 7 user labels, got ${user.length}`);
check(
  EXPECTED_USER.size === user.length && [...user].every(n => EXPECTED_USER.has(n)),
  `user labels are exactly: ${[...EXPECTED_USER].sort().join(', ')}`,
);
check(
  system.every(n => /^[1-8]_/.test(n) || SYSTEM_LABEL_PATTERNS.has(n)),
  'every system-classified repo label is covered by SYSTEM_LABEL_PATTERNS',
);
console.log(`\nUSER labels (guard passes): ${user.sort().join(', ')}`);
console.log(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
process.exitCode = fail === 0 ? 0 : 1;
EOF
npx tsx .devin/tmp/uat-1523-guard-audit.ts
```

**Expected output:**

```text
repo labels: 68
  PASS expected 68 labels, got 68
  PASS expected 61 system labels, got 61
  PASS expected 7 user labels, got 7
  PASS user labels are exactly: documentation, duplicate, enhancement, good first issue, help wanted, invalid, question
  PASS every system-classified repo label is covered by SYSTEM_LABEL_PATTERNS

USER labels (guard passes): documentation, duplicate, enhancement, good first issue, help wanted, invalid, question
ALL CHECKS PASSED
```

The 61 system labels on the repo: `1_IDEA`…`8_LIVE` (8 stage) plus
`APP BACKTEST BE BLOCKED BUG CHART-REVIEW CHORE CONFIG CORE
DATA-PIPELINE DESIGN-SYSTEM DEV-TOOLS DOCS FE FEATURE FLEX-CHART
GALLERY-VIEW HYBRID-QUOTE-PROVIDER IMPL INDICATOR-LIB INTERNAL MAINT
MULTI-LEG-SPREAD OPTIONS ORDER PAPER-TRADING PARTNER PORTFOLIO QA
REFACTOR RH-ACTUAL RH-AGENT RH-AGENT-OBSERVATION RH-FUNDAMENTALS RH-MCP
RS RUN-DASHBOARD SAV-TRAD-NAV SAVANT-TRADER SCREENSHOT SHARED
SIGNAL-REVIEW SPREAD-VIEWER STRAT-BUILD-UI STRAT-LIB STRAT-MANAGE
STRATEGIES SWING-ANALYSIS TECH DEBT TESTING WATCHLIST WONTFIX
WORKFLOWS` (53 name-set labels).

**Result:** PASS — live audit output matched expected block verbatim (68 labels, 61/7 split, ALL CHECKS PASSED)

### S3 — Guard semantics spot-check (concrete names)

```bash
cat > .devin/tmp/uat-1523-guard-spot.ts <<'EOF'
import { isSystemLabel } from '../../shared/lifecycle-labels';
for (const n of ['5_IMPLEMENT','IMPL','DEV-TOOLS','INTERNAL','FEATURE',
 'TECH DEBT','impl','Dev-Tools','core','5_FOO','9_FUTURE',
 'documentation','enhancement','good first issue','help wanted',
 'question','uat-scratch-label']) console.log(n.padEnd(20), isSystemLabel(n));
EOF
npx tsx .devin/tmp/uat-1523-guard-spot.ts
```

**Expected output (exact):**

```text
5_IMPLEMENT          true
IMPL                 true
DEV-TOOLS            true
INTERNAL             true
FEATURE              true
TECH DEBT            true
impl                 true   ← case-insensitive: GitHub resolves 'impl' → 'IMPL'
Dev-Tools            true
core                 true
5_FOO                true   ← pattern, not just the 8 known stages
9_FUTURE             false  ← stages are 1–8 only
documentation        false
enhancement          false
good first issue     false
help wanted          false
question             false
uat-scratch-label    false
```

**Result:** PASS — output matched the expected table verbatim, incl. `impl`/`5_FOO` → true and `9_FUTURE`/`uat-scratch-label` → false

### S4 — Alias resolves in all three compile contexts

All commands below run from the repo root `C:\aa\projects\rel-str`.

```bash
# jest context — the spec is resolved through the jest moduleNameMapper alias
npx jest shared/lifecycle-labels.spec.ts --coverage=false   # → Tests: 90 passed

# functions context — label-callables.ts imports '@lifecycle/labels'
cd functions && npm run build && cd ..                    # → lib\index.js bundle, no errors

# app context — a scratch import compiled under the app tsconfig's paths
mkdir -p .devin/tmp
cat > .devin/tmp/alias-check.ts <<'EOF'
import { isSystemLabel, SYSTEM_LABEL_PATTERNS } from '@lifecycle/labels';
console.log(isSystemLabel('IMPL'), SYSTEM_LABEL_PATTERNS.size);
EOF
cat > .devin/tmp/tsconfig.alias-check.json <<'EOF'
{
  "extends": "../../tsconfig.json",
  "include": ["alias-check.ts"],
  "compilerOptions": { "noEmit": true }
}
EOF
npx tsc -p .devin/tmp/tsconfig.alias-check.json              # → exit 0, no output
```

**Expected:** jest 90 pass; functions esbuild bundle (`lib\index.js`,
no errors); `tsc` exits 0 silently — proving `@lifecycle/labels`
resolves under the app tsconfig's `paths`.

**Result:** PASS — jest 90; functions esbuild `libindex.js` clean; `tsc -p` exit 0 (app alias resolves)

### S5 — Boundary enforcement at the consumers (node:test suite)

```bash
npx tsx --test tests/functions/gh-lifecycle/label-callables.test.ts
```

**Expected:** `pass 22 / fail 0`. Covers `updateIssueLabels` rejecting
non-array `add`/`remove`, stage names in both directions,
`manageRepoLabel` rejecting system-label targets (create-stage /
update-taxonomy / delete-domain / rename-into-taxonomy), and all
op-flows against the injected REST fixture.

**Result:** PASS — `pass 22 / fail 0`

### S6 — End-to-end contract check via the live labels read

```bash
export NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx scripts/verify/dev-tools-gh-lifecycle-1528-labels-read.ts
```

**Expected:** `ALL CHECKS PASSED` — pages all 68 real labels on
`rinebob/rel-str` through the `RepoLabel`/`ListRepoLabelsResponse`
contract and the REST transport.

**Result:** PASS — `ALL CHECKS PASSED` on both repos (68 labels rel-str, av-proxy-api)

## Regression / smoke checklist

- [x] `npx jest shared/ --coverage=false` — all shared specs green
      (53 suites / 1088 tests)
- [x] `npx tsx --test tests/functions/gh-lifecycle/*.test.ts` — all
      55 cases green (glob required — directory paths fail)
- [x] Topic Viewer page at `http://localhost:4210` still renders (no
      contract change should affect it — smoke only)

## Traceability

| Criterion | Scenario |
|---|---|
| Contracts + guard exported from `shared/lifecycle-labels.ts` | S1, S4 |
| `isSystemLabel` spec: stage/structural/DOMAIN/Category excluded; arbitrary pass | S1, S2, S3 |
| Constant documented as manually synced with `project-config.json` | S1 (spec pins vocabulary), code review |
| Alias resolves app/functions/jest | S4 |
| Boundary enforcement (non-array, stage both dirs, system-label manage) | S5 |
| Contracts work against the live repo | S2, S6 |

## Results log

- 2026-11-15 — UAT drafted; all six scenarios + regression executed by
  QA agent — **QA PASS**.

## Findings

- None — no QA-found defects. The round-1 review findings (junk-label
  write via un-normalized add/remove, missing SYSTEM_LABEL_PATTERNS
  export, case-sensitivity hole) were remediated before this gate.
