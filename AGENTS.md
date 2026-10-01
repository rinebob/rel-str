# AGENTS.md

## Environment

### Do NOT write temp files to C:\Users\bob\AppData\Local\Temp

The IDE (Windsurf) watches that directory and prompts the user to approve
every file created there — hundreds per day. Instead:

- **For commit messages:** use PowerShell here-strings with `git commit -m`:
  ```powershell
  $msg = @"
  326-374_FE-IMPL-OPTIONS: Subject line

  - Bullet 1
  - Bullet 2
  "@
  git commit -m $msg
  ```
- **For other temp files:** write to `.devin/tmp/` inside the repo (gitignored).
- **Never** use `C:\Users\bob\AppData\Local\Temp\` or any path under
  `C:\Users\bob` for temp files.

### Node.js IPv6 workaround (required for firebase CLI)

AT&T gateway has broken IPv6 routing. Node.js 24 tries IPv6 first and hangs.
A preload script forces IPv4-only DNS resolution. It's loaded via a
user-level `NODE_OPTIONS` env var:

- **Script:** `C:\Users\bob\.config\node\ipv4-only.cjs`
- **Env var:** `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` (user-level, persistent)

New terminals pick this up automatically. If a terminal was opened before
the env var was set, run this manually:

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
```

See `docs/dev-notes/IPV6-NODEJS-NETWORK-ISSUE.md` for full details.

## Build & Deploy

- **Functions build:** `cd functions && npm run build`
- **Deploy functions:** `firebase deploy --only functions`
- **SDS tests:** `cd functions && npm run test:sds`

## Testing (jest 30 + jest-preset-angular)

- `npx jest` — full suite (`--coverage=false` to skip coverage).
- `setup-jest.ts` shims legacy jasmine APIs (`jasmine.createSpy`,
  `spy.and.*`, `spy.calls.*`, `jasmine.anything/objectContaining/…`).
  New specs should prefer `jest.fn()` and `expect.*` directly.
- **`fakeAsync`/`tick` cannot flush native `await`/`firstValueFrom`** — the
  transformer no longer downlevels async/await. For async code paths, write
  `async` tests and flush with a macrotask boundary:
  `await new Promise<void>((r) => setTimeout(r, 0))` (drains the whole
  microtask queue; `setImmediate` is unavailable under jsdom). Do NOT use
  this flush under `jest.useFakeTimers()` — it will hang. `jasmine.clock`
  is not supported; the shim throws — use jest fake timers instead.
- Firebase injection tokens in component/service specs: provide stub
  providers — `{ provide: Firestore, useValue: {} }`, `{ provide: Auth,
  useValue: {} }`, `{ provide: Functions, useValue: {} }` — or mock the
  service that calls Firebase (preferred when init code calls methods).
- `.devin/` is excluded from jest test discovery — don't put specs there.

## Firestore

### Collection naming convention

New root collections must carry a **domain prefix** so the console sorts
into visual groups and one-off names are avoided:

| Domain | Prefix | Examples |
|--------|--------|----------|
| Savant Trader / indicator-lib | `st-` | `st-swing-sets` |
| Agent pipeline | `rh-agent-` | `rh-agent-runs` |
| Options | `options-` | `options-file-index` |
| Backtest | `backtest-` | `backtest-runs` |
| Portfolio | `portfolio` (anchored) | `portfolio/buckets/items`, `portfolio/attributions/items` |

Flat collections with composite doc ids (`{entity}_{key}`) are preferred
over nested trees — they allow single-query enumeration. For domains with
several record kinds, prefer ONE namespaced root using the anchor pattern
(`{domain}/{kind-anchor}/items/{id}` — established by `paper-trading`,
used by `portfolio`) over several `domain-*` root collections: the console
stays browsable and each kind still scopes cleanly for rules/queries.
Do not create catch-all collections that mix unrelated doc types (breaks
security-rule granularity, query filters, and index management).

**Anchor pattern (Topic #553, Blueprint #557 — generalized):** domains with
multiple record kinds use a single root collection with per-kind anchor docs —
`{domain}/{kind-anchor}/items/{id}` — so record types stay grouped (no
mixed-type catch-all) while remaining browsable in the console. Each kind
occupies its own `items` subcollection, so security rules and queries still
scope per-kind via the path wildcard. Indexes declared on collectionGroup
`items` are shared across all anchored domains — queries must target the
full collection path (`collection(db, 'portfolio/buckets/items')`), not a
collectionGroup, or they span domains.

## Project Workflow

### Task stage labels

Tasks advance through stage labels on the GitHub issue:

`4_BACKLOG` → `5_IMPLEMENT` → `6_REVIEW` → `7_QA` → `8_LIVE`

`7_QA` is not automatic: after `/proj review` passes and the task reaches `7_QA`, run `/proj qa {topic} {task}` to execute the QA checklist and set the linked QA issue **Status** = `RESOLVED`. `/proj ship` will not proceed until the QA issue is RESOLVED.

### Advancing a task

Swap the stage label and update the project Status field. Example —
advancing task #336 from `5_IMPLEMENT` to `6_REVIEW`:

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
gh issue edit 336 --remove-label "5_IMPLEMENT" --add-label "6_REVIEW"
gh project item-edit --id PVTI_lAHOAlkFjc4BfMS9zg7KcHY --project-id PVT_kwHOAlkFjc4BfMS9 --field-id PVTSSF_lAHOAlkFjc4BfMS9zhZg6AA --single-select-option-id 4fb017f2
```

Project field IDs (Savant Trader project #1):
- Project node ID: `PVT_kwHOAlkFjc4BfMS9`
- Status field ID: `PVTSSF_lAHOAlkFjc4BfMS9zhZg6AA`
- Status options: NOT STARTED=`b5d4c042`, IN PROGRESS=`4fb017f2`, RESOLVED=`57f03408`, N/A=`9339766f`

### Summary convention

Always include the **next `/proj` slash command** in task summaries so the user
doesn't have to hunt for it. Examples: `/proj review 261 336`, `/proj ship 261 336`,
`/proj implement 261 337`.

### Doc header convention (non-negotiable)

Every proj-workflow document header (PRD/IMPL/TEST/CODE-REVIEW/UAT/etc.) is
plain markdown — NO `---` fences — with **each field on its own physical
line**, each line ending in **two trailing spaces** (markdown line break).
Never put multiple fields on one line, never use pipes between fields,
never use `<br>`.

Canonical field order for threaded docs:

```markdown
**Topic:** {Topic Name}  
**Topic Slug:** {topic-slug}  
**Thread:** {Thread Name}  
**Thread Slug:** {thread-slug}  
**Issue:** #{issue}  
**Thread Parent:** #{thread-issue}  
**Topic Parent:** #{topic-issue}  
**Task:** #{task-issue}  
**Domain:** {DOMAIN}  
**Type:** {DOC TYPE}  
**Status:** {Draft|Approved|Complete|Abandoned|Superseded}  
**Created:** {YYYY-MM-DD}  
**Last Updated:** {YYYY-MM-DD}  
```

Full spec: `.devin/skills/proj/REFERENCE.md` → "Doc header template".
