# AGENTS.md

## Environment

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
