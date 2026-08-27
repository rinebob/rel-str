# IPv6 / Node.js Network Issue

**Date:** 2026-08-27
**Status:** Resolved (workaround in place)

---

## Symptom

`firebase login --reauth` and `firebase deploy --only functions` fail with:

```
Authentication Error: Your credentials are no longer valid.
Error: Failed to make request to https://auth.firebase.tools/attest
```

`firebase login` reports "Already logged in" (reads cached token), but the
token cannot be refreshed because the attest endpoint is unreachable from
Node.js.

## Root cause

Two things combined:

### 1. AT&T gateway has broken IPv6 routing

The AT&T residential gateway (BGW320/BGW210) advertises IPv6 addresses via
SLAAC/DHCPv6, so Windows configures IPv6 addresses and routes. Local IPv6
works (can ping the gateway `2600:1700:...::1` at 2ms). But the gateway does
not forward IPv6 packets to the internet — Google's IPv6 addresses
(`2001:4860:4802:...`) are unreachable:

```
> ping 2001:4860:4802:32::15
PING: transmit failed. General failure.
```

This is a known AT&T Fiber issue — the gateway has incomplete/buggy IPv6
support. It assigns addresses and routes within the LAN but doesn't properly
forward to the WAN.

### 2. Node.js 24 changed DNS resolution order

Node.js v24.7.0 is installed. Starting in Node 17, the default
`dns.getDefaultResultOrder()` changed from `ipv4first` to `verbatim` (follows
OS DNS ordering, which returns IPv6 first). Node 24 also uses Happy Eyeballs
(RFC 8305) which tries IPv6 and IPv4 in parallel — but the broken IPv6
connection doesn't fail fast (it's "transmit failed / general failure", not
"connection refused"), so Node.js hangs waiting for the IPv6 attempt to time
out instead of falling back to IPv4.

Previous Node versions (16 and earlier) tried IPv4 first, so the broken IPv6
never mattered. Deployments worked for years until the Node upgrade.

### Why PowerShell works but Node.js doesn't

PowerShell's `Invoke-WebRequest` and `Test-NetConnection` use Windows
`getaddrinfo`, which tries IPv4 first and falls back quickly. Node.js 24's
Happy Eyeballs algorithm tries IPv6 in parallel and gets stuck.

## Fix

A preload script forces Node.js `dns.lookup` to use IPv4 only:

**Script:** `C:\Users\bob\.config\node\ipv4-only.cjs`

```js
// Patches dns.lookup to filter out IPv6 addresses.
// Workaround for networks where IPv6 is broken but Node.js tries it anyway.
const dns = require('dns');
const origLookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  // Force IPv4 only
  options = { ...options, family: 4 };
  return origLookup.call(this, hostname, options, callback);
};
```

**Env var (user-level, persistent):**

```powershell
[System.Environment]::SetEnvironmentVariable(
  "NODE_OPTIONS",
  "--require C:\Users\bob\.config\node\ipv4-only.cjs",
  "User"
)
```

Every Node.js process (including `firebase` CLI) loads this automatically.
Open a new terminal after setting it for the env var to take effect.

## Verification

```powershell
# Before fix (broken):
> node -e "const https=require('https');const r=https.request('https://auth.firebase.tools/attest',{method:'POST',timeout:10000},res=>{console.log('status:',res.statusCode)});r.on('error',e=>console.log('error:',e.message,e.code));r.on('timeout',()=>{console.log('TIMEOUT');r.destroy()});r.end()"
error:  ETIMEDOUT

# After fix (working):
> node -e "const https=require('https');const r=https.request('https://auth.firebase.tools/attest',{method:'POST',timeout:10000},res=>{console.log('status:',res.statusCode)});r.on('error',e=>console.log('error:',e.message,e.code));r.on('timeout',()=>{console.log('TIMEOUT');r.destroy()});r.end()"
status: 400
```

## Permanent network-level fixes (optional)

The Node.js workaround above is sufficient. If you want to actually fix IPv6:

1. **Log into the AT&T gateway** (usually `192.168.1.254`) — check IPv6
   settings. Disabling and re-enabling IPv6 can rebuild the routing table.
2. **Update gateway firmware** — AT&T has pushed IPv6 routing fixes in some
   BGW firmware versions.
3. **IP Passthrough / Bridge mode** — put the gateway in passthrough and use
   your own router with working IPv6.
4. **Disable IPv6 on the gateway** — then Windows won't get IPv6 addresses
   and everything falls back to IPv4 cleanly. The `NODE_OPTIONS` workaround
   becomes a no-op.

## Related

- SDS intraday dispatch bug fix (2026-08-27) — the deploy that triggered
  this issue. See `functions/src/symbol-data-sync/sds-core.ts`.
