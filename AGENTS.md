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
