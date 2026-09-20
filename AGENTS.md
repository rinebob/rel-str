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

Flat collections with composite doc ids (`{entity}_{key}`) are preferred
over nested trees — they allow single-query enumeration. Do not create
catch-all collections that mix unrelated doc types (breaks security-rule
granularity, query filters, and index management).

## Project Workflow

### Task stage labels

Tasks advance through stage labels on the GitHub issue:

`4_BACKLOG` → `5_IMPLEMENT` → `6_REVIEW` → `7_QA` → `8_LIVE`

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
