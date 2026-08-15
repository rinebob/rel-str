# RH Agent MCP Observation Backend — As-Built

This document describes the backend Robinhood MCP interaction exactly as it is implemented today. It is split into three parts:

1. **Plain-English process description** — what happens, in order, with no code.
2. **Same description annotated with code paths** — the files and functions that carry out each step.
3. **Implementation reference** — enough detail for another developer to reproduce the same backend in a different app.

> Scope note: this is the backend only. The Angular observation dashboard is out of scope.

---

## Part 1 — What happens (plain English)

### 1. The moving pieces

The backend needs a Robinhood OAuth access token before it can call the Robinhood MCP server. The pieces that make this work are:

- **Credential store** — an encrypted file on the local Windows machine that holds the OAuth tokens, client registration, and server discovery metadata.
- **OAuth provider** — an adapter that lets the Model Context Protocol (MCP) SDK read and write that credential store.
- **Bootstrap runner** — the interactive flow that gets the first OAuth token.
- **Callback server** — a temporary loopback web server that catches the browser redirect from Robinhood.
- **MCP session** — a thin wrapper around the MCP SDK `Client` that connects to Robinhood over Streamable HTTP.
- **Tool catalog** — a local JSON file that lists all known Robinhood MCP tools; the backend uses it to decide which tools are read-only and safe for observation.
- **Tool executor** — the function that validates a tool name, opens an MCP session, calls the tool, parses the result, and redacts sensitive fields.
- **Local API** — a small loopback-only HTTP server that exposes `GET /api/rh/tools` and `POST /api/rh/tools/{toolName}` so the frontend can call the executor without holding credentials.
- **Cloud credential proof** — a Firebase Cloud Function (`rhCloudCredentialProof`) and supporting diagnostic scripts that prove a locally-bootstrapped credential can be transferred to Google Secret Manager and used from a cloud IP for unattended read-only MCP calls. Proven 2026-08-14.

### 2. First-time authentication (OAuth bootstrap)

This flow is run from the terminal, usually with `npm --prefix functions run probe:rh-agent-mcp-auth`.

1. The bootstrap runner creates a credential store pointing at `%LOCALAPPDATA%\rel-str\rh-agent-mcp\credentials.dpapi` on Windows. The file is encrypted with Windows DPAPI.
2. It checks the store for an existing Robinhood credential.
3. If a credential exists and its access token is not about to expire, it skips ahead to **step 8**.
4. If the token exists but is about to expire, it tries to refresh the access token using the saved refresh token and the saved authorization-server metadata.
5. If there are no stored tokens at all, it starts an interactive OAuth flow. If a stored token exists but cannot be refreshed (for example, because the refresh token was revoked), the bootstrap reports `REAUTHORIZATION_REQUIRED` and stops instead of falling back to interactive auth.
   - It starts a temporary web server on `127.0.0.1` (default port `3456`, configurable via `callbackPort`).
   - It generates a random OAuth state and a PKCE code verifier.
   - It opens the system browser to the Robinhood OAuth authorization URL.
   - The user logs in and approves the app.
   - Robinhood redirects the browser back to the temporary loopback server with an authorization code.
   - The callback server checks the OAuth state and extracts the code.
   - The backend exchanges the authorization code for access and refresh tokens.
6. The backend saves the tokens, the OAuth client registration, and the server discovery metadata to the encrypted credential file.
7. It closes the temporary callback server.
8. It creates an MCP client, connects to `https://agent.robinhood.com/mcp/trading` over Streamable HTTP using the access token, and lists the available tools to prove the connection works.
9. It reports `state: CONNECTED` and a bundle of evidence (token present, refresh token present, tool count, etc.).

### 3. Reusing an existing credential

Once the credential file exists, later tool calls reuse it automatically.

1. The backend loads the credential file and decrypts it.
2. It checks the access token expiry. If the token is within one minute of expiring, it refreshes the token first.
3. It creates a new MCP session with the current access token.
4. It calls the requested tool and immediately closes the session.

No browser is needed for reuse. Each tool call opens and closes its own MCP session.

### 4. Making an observation tool call

Tool calls can be triggered in two ways:

- **Diagnostic CLI** — `npm --prefix functions run probe:rh-agent-mcp-tool -- get_accounts`
- **Local API** — `POST http://127.0.0.1:3456/api/rh/tools/get_accounts` with a JSON body

In both cases the backend does the following:

1. It checks the requested tool name against a hard-coded allowlist of read-only observation tools (`get_accounts`, `get_portfolio`, `get_equity_positions`, `get_equity_quotes`, `get_equity_orders`, `get_equity_fundamentals`, `get_equity_historicals`). Mutation tools such as `place_equity_order` are rejected.
2. It loads the local tool catalog to confirm the tool exists and to obtain its input schema; it does not currently validate the supplied `args` against that schema.
3. It connects to Robinhood using the stored credential (refreshing if needed).
4. It calls the MCP `tools/call` endpoint with the tool name prefixed as `mcp__robinhood-trading__{toolName}`.
5. It parses the result, which is returned as an MCP `text` content item containing a JSON string.
6. It redacts the result. By default it masks account numbers, names, SSN/TIN, email, phone, address, DOB, and any key matching patterns like `*_account_number`, `*_id`, `*_uuid`, `*_url`, or exact `id`/`uuid`/`url`. Callers can also request extra redaction fields.
7. It returns both the raw parsed JSON (`parsed`) and the redacted view (`redacted`) so the caller can use raw values internally while only showing the redacted view to the user.

### 5. The local HTTP API

A standalone Node HTTP server can be started with `npm --prefix functions run serve:observation`.

- It binds to `127.0.0.1:3456` by default.
- It refuses to start or respond if the host is not `127.0.0.1`/`localhost`, if the request does not come from a loopback address, or if `NODE_ENV` is `production`.
- Request bodies are limited to 1 MB.
- It has two routes:
  - `GET /api/rh/tools` — returns the allowlisted observation tool definitions.
  - `POST /api/rh/tools/{toolName}` — executes one observation tool. The JSON body may contain `args` and `extraRedactFields`.
- All responses are JSON with a `success` boolean.

---

## Part 2 — What happens, with code paths

This part repeats the narrative above but points to the exact files and functions.

### Credential storage

- The credential store is defined in `functions/src/rh-agent-mcp/auth/local-credential-repository.ts`.
- The interface `RobinhoodCredentialRepository` is in `functions/src/rh-agent-mcp/auth/credential-repository.ts`.
- The concrete store is `EncryptedFileCredentialRepository` in `functions/src/rh-agent-mcp/auth/encrypted-file-credential-repository.ts`.
- Encryption is done by `DpapiCredentialCipher` in `functions/src/rh-agent-mcp/auth/dpapi-credential-cipher.ts`, which shells out to PowerShell and calls `System.Security.Cryptography.ProtectedData.Protect`/`Unprotect` under `CurrentUser` scope.
- The bundle type (`RobinhoodCredentialBundle`) is declared in `functions/src/rh-agent-mcp/contracts/authentication.ts` and includes `schemaVersion`, `revision`, `tokens`, optional `clientInformation`, optional `discoveryState`, and `lastTokenResponseAt`.

### First-time OAuth bootstrap

- Entry point: `npx tsx src/rh-agent-mcp/diagnostics/run-local-oauth-bootstrap.ts` (also exposed as `npm --prefix functions run probe:rh-agent-mcp-auth`) calls `runLocalOAuthBootstrapWithDependencies` in `functions/src/rh-agent-mcp/auth/local-oauth-bootstrap.ts`.
- `runLocalOAuthBootstrapWithDependencies` builds the `RepositoryOAuthProvider` (`functions/src/rh-agent-mcp/auth/repository-oauth-provider.ts`) over the `createLocalCredentialRepository()` store.
- It checks the current bundle with `provider.currentBundle()`.
- If the bundle is reusable, `DefaultTokenRefreshPolicy` in `functions/src/rh-agent-mcp/auth/token-refresh-policy.ts` decides whether to refresh; if so, `refreshStoredCredential` in `functions/src/rh-agent-mcp/auth/stored-credential-refresh.ts` calls MCP SDK `refreshAuthorization` and `provider.saveTokens()`.
- If no credential exists, `startLocalOAuthCallbackServer` in `functions/src/rh-agent-mcp/auth/local-oauth-callback-server.ts` starts a temporary `node:http` server on `127.0.0.1` using port `LOCAL_OAUTH_CALLBACK_PORT` (`3456` by default, overridable via `callbackPort`) and a configurable timeout.
- `openAuthorizationUrl` in `functions/src/rh-agent-mcp/auth/open-authorization-url.ts` spawns the system browser (`rundll32.exe` on Windows, `open` on macOS, `xdg-open` on Linux).
- The actual authorization flow is driven by the MCP SDK `auth` function, configured in the local `sdkAuthorize` closure with `serverUrl` taken from `ROBINHOOD_TRADING_MCP_URL` in `functions/src/rh-agent-mcp/contracts/robinhood-mcp.ts`.
- The SDK calls `provider.clientInformation()`, `provider.saveClientInformation()`, `provider.saveDiscoveryState()`, `provider.saveCodeVerifier()`, and `provider.redirectToAuthorization()`.
- After browser redirect, the callback server validates the `state` parameter with `timingSafeEqual`, extracts the `code`, and returns a plain-text success page.
- `local-oauth-bootstrap.ts` then calls `authorize(provider, authorizationCode)` again to exchange the code for tokens.
- `provider.saveTokens()` persists the bundle with optimistic-concurrency `expectedRevision`; `EncryptedFileCredentialRepository.store` rejects if the file changed underneath (throws `CredentialRevisionConflictError`).
- `runSession` creates `RobinhoodMcpSession` from `functions/src/rh-agent-mcp/client/robinhood-mcp-session.ts`, calls `session.connect()`, then `session.getToolDefinitions()` (formerly `listTools`) to verify connectivity.
- Errors are classified by `classifyAuthenticationError` in `functions/src/rh-agent-mcp/auth/authentication-error-classifier.ts` and evidence is built by `buildBootstrapEvidence` in `functions/src/rh-agent-mcp/auth/bootstrap-evidence.ts`.

### Reusing a credential for a tool call

- For ad-hoc CLI use, `npx tsx src/rh-agent-mcp/diagnostics/run-tool-observation.ts <toolName> [args-json-path] [extraRedactField...]` calls `executeObservationTool` in `functions/src/rh-agent-mcp/tools/robinhood-tool-executor.ts`.
- `executeObservationTool` calls `connectLocalRobinhoodMcpSession` in `functions/src/rh-agent-mcp/auth/robinhood-mcp-connection.ts`.
- `connectLocalRobinhoodMcpSession` loads/decrypts the credential, refreshes if `DefaultTokenRefreshPolicy.shouldRefresh` says it is needed, creates a `RobinhoodMcpSession`, and calls `session.connect()`.
- `RobinhoodMcpSession.connect` reads the access token, creates a `StreamableHTTPClientTransport` with `Authorization: Bearer <access_token>`, and calls `client.connect(transport)` against `ROBINHOOD_TRADING_MCP_URL`.
- `executeObservationTool` then calls `connection.session.callTool(toServerToolName(toolName), args)`.
- `toServerToolName` and the observation allowlist live in `functions/src/rh-agent-mcp/tools/robinhood-tools.ts`.
- The raw MCP result is parsed by `parseToolResult` in `robinhood-tool-executor.ts`, which expects `result.content[0].text` to be a JSON string.
- The parsed result is redacted by `redactResponse` in `functions/src/rh-agent-mcp/tools/robinhood-response-redactor.ts`.
- `maskAccountNumber` is imported from the shared utility `@rh-agent-mcp/utils` (`shared/robinhood-mcp-utils.ts`).
- The result is returned as a `ToolExecutionResult` defined in the shared contract `@rh-agent-mcp/contracts` (`shared/robinhood-mcp-contracts.ts`).

### Local HTTP API

- Entry point: `npx tsx src/rh-agent-mcp/local-api/start-observation-api.ts` (also `npm --prefix functions run serve:observation`) calls `startRobinhoodObservationApi` in `functions/src/rh-agent-mcp/local-api/robinhood-observation-api.ts`.
- `createRobinhoodObservationApi` creates a `node:http` server.
- It blocks non-loopback remote addresses and refuses to run in production (`isNotLocalEnvironment`).
- `readBody` caps the body at `MAX_BODY_SIZE = 1 MB`.
- The route table has two routes:
  - `GET /api/rh/tools` -> `handleListTools` -> `listObservationTools`.
  - `POST /api/rh/tools/{toolName}` -> `handleExecuteTool` -> validates `toolName` consistency, validates `extraRedactFields`, then `executeObservationTool`.
- Responses are built with `sendJson`.

### Cloud credential proof (Phase 4)

The cloud credential proof proves that a locally-bootstrapped Robinhood credential can be used from a Firebase Cloud Function for unattended read-only MCP calls. This was proven on 2026-08-14. See `RH-AGENT-DIRECT-MCP-AUTH-PROOF-2607-01.md` Phase 4 for the full proof record.

The proof uses three new components:

- **Credential export** — `diagnostics/export-credential-bundle.ts` decrypts the local DPAPI credential file and writes a portable JSON bundle to a caller-specified path. Usage: `npx tsx src/rh-agent-mcp/diagnostics/export-credential-bundle.ts <output-path>`. The output contains live OAuth tokens; it must never be committed and should be deleted after the cloud proof is complete.
- **Portable credential repository** — `auth/portable-file-credential-repository.ts` implements `RobinhoodCredentialRepository` using a plaintext JSON file with the same revision/CAS semantics as `EncryptedFileCredentialRepository`, but without DPAPI or Windows dependencies. This is the prototype for the eventual Secret Manager-backed repository.
- **Cloud proof function** — `diagnostics/cloud-credential-proof-function.ts` is a Firebase HTTP function (`rhCloudCredentialProof`) that reads the `RH_CREDENTIAL_BUNDLE` Secret Manager secret, writes it to a temp file, uses `PortableFileCredentialRepository` to load it, connects via `connectLocalRobinhoodMcpSession`, and calls `get_option_chains`. Returns only `{ success, proof, tool, chainCount, credentialRevision }`.

The tool catalog loading in `tools/robinhood-tools.ts` was also updated to fall back to a static JSON import (`import toolCatalogJson from '../../../.rh-mcp-tool-catalog.json'`) when the catalog file is not found on disk. This is needed because Cloud Functions bundles code with esbuild and the `.rh-mcp-tool-catalog.json` file is not present in the deployment package.

### Rate limit and latency probes (2026-08-14)

Two diagnostic scripts were added to probe the Robinhood MCP rate limit and latency characteristics. See `RH-AGENT-ROBINHOOD-MCP-DISCOVERY-USAGE-2607-01.md` "Rate limit and latency findings" for the full results.

- `diagnostics/run-rate-limit-probe.ts` — makes N sequential `get_option_chains` calls using the per-call session pattern (each call opens/closes its own session). Usage: `npx tsx src/rh-agent-mcp/diagnostics/run-rate-limit-probe.ts [count] [delayMs]`
- `diagnostics/run-rate-limit-probe-reuse.ts` — makes N `get_option_chains` calls through a single reused MCP session. Usage: `npx tsx src/rh-agent-mcp/diagnostics/run-rate-limit-probe-reuse.ts [count]`

Key findings: no rate limit was hit at 100 total calls; the bottleneck is latency (~1-2.6s per call); session reuse doubles throughput from 23 to 60 req/min.

---

## Part 3 — Implementation reference

This part is written for a developer who wants to reproduce the same backend in another project.

### Dependencies

The functions package (`functions/package.json`) uses:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.29.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.8.0"
  }
}
```

`@modelcontextprotocol/sdk` provides the OAuth helpers (`auth`, `refreshAuthorization`), the MCP `Client`, and the `StreamableHTTPClientTransport`.

### Required source files

All paths are relative to `functions/src/rh-agent-mcp/`:

| Concern | Files |
| --- | --- |
| Constants | `contracts/robinhood-mcp.ts` |
| Types | `contracts/authentication.ts`, `shared/robinhood-mcp-contracts.ts` |
| Credential store | `auth/credential-repository.ts`, `auth/local-credential-repository.ts`, `auth/encrypted-file-credential-repository.ts`, `auth/dpapi-credential-cipher.ts`, `auth/portable-file-credential-repository.ts` |
| OAuth provider | `auth/repository-oauth-provider.ts` |
| Callback server | `auth/local-oauth-callback-server.ts` |
| Browser launcher | `auth/open-authorization-url.ts` |
| Refresh logic | `auth/stored-credential-refresh.ts`, `auth/token-refresh-policy.ts` |
| Bootstrap orchestration | `auth/local-oauth-bootstrap.ts` |
| Session connection | `client/robinhood-mcp-session.ts` |
| Connection helper | `auth/robinhood-mcp-connection.ts` |
| Tool catalog/allowlist | `tools/robinhood-tools.ts`, `functions/.rh-mcp-tool-catalog.json` (functions package root, also bundled via static JSON import for Cloud Functions) |
| Tool executor | `tools/robinhood-tool-executor.ts` |
| Response redaction | `tools/robinhood-response-redactor.ts` |
| Shared contracts/utilities | `shared/robinhood-mcp-contracts.ts`, `shared/robinhood-mcp-utils.ts` |
| Local API | `local-api/robinhood-observation-api.ts`, `local-api/start-observation-api.ts` |
| Diagnostic scripts | `diagnostics/run-local-oauth-bootstrap.ts`, `diagnostics/run-tool-observation.ts`, `diagnostics/export-credential-bundle.ts`, `diagnostics/run-cloud-credential-proof.ts`, `diagnostics/run-rate-limit-probe.ts`, `diagnostics/run-rate-limit-probe-reuse.ts` |
| Cloud proof function | `diagnostics/cloud-credential-proof-function.ts` |
| Error classification | `auth/authentication-error-classifier.ts` |
| Evidence builder | `auth/bootstrap-evidence.ts` |

### Constants

`functions/src/rh-agent-mcp/contracts/robinhood-mcp.ts`:

```ts
export const ROBINHOOD_TRADING_MCP_URL = 'https://agent.robinhood.com/mcp/trading';
export const LOCAL_OAUTH_CALLBACK_PORT = 3456;
export const LOCAL_OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1_000;
```

### Credential repository interface

`functions/src/rh-agent-mcp/auth/credential-repository.ts`:

```ts
import type { RobinhoodCredentialBundle } from '../contracts/authentication';

export interface RobinhoodCredentialRepository {
  load(): Promise<RobinhoodCredentialBundle | null>;
  store(
    credential: RobinhoodCredentialBundle,
    expectedRevision: number | null,
  ): Promise<RobinhoodCredentialBundle>;
  delete(): Promise<void>;
}
```

### DPAPI cipher (Windows only)

`functions/src/rh-agent-mcp/auth/dpapi-credential-cipher.ts`:

```ts
import { spawn } from 'node:child_process';
import type { CredentialCipher } from './encrypted-file-credential-repository';

const PROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security',
  '$value = [Console]::In.ReadToEnd()',
  '$bytes = [Text.Encoding]::UTF8.GetBytes($value)',
  '$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($protected))',
].join('; ');

const UNPROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security',
  '$value = [Console]::In.ReadToEnd()',
  '$bytes = [Convert]::FromBase64String($value)',
  '$plaintext = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plaintext))',
].join('; ');

export class DpapiCredentialCipher implements CredentialCipher {
  encrypt(plaintext: string): Promise<string> {
    return runPowerShell(PROTECT_SCRIPT, plaintext);
  }
  decrypt(ciphertext: string): Promise<string> {
    return runPowerShell(UNPROTECT_SCRIPT, ciphertext);
  }
}
```

### Encrypted file store

`functions/src/rh-agent-mcp/auth/encrypted-file-credential-repository.ts` stores a JSON bundle as a base64 DPAPI-protected string. It uses a directory lock to serialize writes and uses optimistic-concurrency on `revision`.

### OAuth provider

`functions/src/rh-agent-mcp/auth/repository-oauth-provider.ts` implements the MCP SDK `OAuthClientProvider` interface over the repository. It defers loading until first use (`ensureLoaded`) and stores tokens with a monotonically increasing revision.

### Bootstrap orchestration

`functions/src/rh-agent-mcp/auth/local-oauth-bootstrap.ts` is the high-level flow:

```ts
export async function runLocalOAuthBootstrapWithDependencies(
  options: LocalOAuthBootstrapDependencies,
): Promise<LocalOAuthBootstrapResult> {
  const repository = options.repository ?? createLocalCredentialRepository();
  const now = options.now ?? (() => new Date());
  const refreshPolicy = options.refreshPolicy ?? new DefaultTokenRefreshPolicy();
  let state: string | undefined = randomBytes(32).toString('base64url');
  const callbackServer = await startLocalOAuthCallbackServer({
    expectedState: state,
    port: options.callbackPort ?? LOCAL_OAUTH_CALLBACK_PORT,
    timeoutMs: options.callbackTimeoutMs ?? LOCAL_OAUTH_CALLBACK_TIMEOUT_MS,
  });
  void callbackServer.callback.catch(() => undefined);
  const provider = new RepositoryOAuthProvider(
    repository,
    {
      redirectUrl: callbackServer.redirectUrl,
      state,
      now,
      openAuthorizationUrl: options.openAuthorizationUrl ?? openAuthorizationUrl,
    },
  );
  const authorize = options.authorize ?? sdkAuthorize;

  try {
    const currentTime = now();
    const bundle = await provider.currentBundle();
    const previousRevision = provider.currentRevision();

    if (bundle?.tokens && !refreshPolicy.shouldRefresh(bundle, currentTime, options.forceRefresh)) {
      provider.clearBootstrapState();
      return await runSession(provider, options.transportFactory, 'STORED_CREDENTIAL_REUSED', false, NO_REFRESH_EVIDENCE);
    }

    if (bundle?.tokens) {
      return await tryRefreshStoredCredential(
        provider,
        currentTime,
        options.refreshFetch,
        options.transportFactory,
        previousRevision,
      );
    }

    return await performInitialAuthorization(
      provider,
      authorize,
      callbackServer,
      options.transportFactory,
    );
  } finally {
    state = undefined;
    provider.clearBootstrapState();
    await callbackServer.close();
  }
}
```

### Token refresh

`functions/src/rh-agent-mcp/auth/stored-credential-refresh.ts`:

```ts
const refreshedTokens = await refreshAuthorization(
  discoveryState.authorizationServerUrl,
  {
    metadata: discoveryState.authorizationServerMetadata,
    clientInformation,
    refreshToken: tokens.refresh_token,
    resource: discoveryState.resourceMetadata?.resource === undefined
      ? undefined
      : new URL(discoveryState.resourceMetadata.resource),
    fetchFn: options.fetchFn,
  },
);
await provider.saveTokens(refreshedTokens);
return { refreshTokenRotated: refreshedTokens.refresh_token !== tokens.refresh_token };
```

### MCP session

`functions/src/rh-agent-mcp/client/robinhood-mcp-session.ts`:

```ts
export class RobinhoodMcpSession {
  private client: Client | undefined;
  private transport: Transport | undefined;

  constructor(
    private readonly provider: OAuthClientProvider,
    private readonly createTransport: RobinhoodMcpTransportFactory = createRobinhoodTransport,
  ) {}

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const tokens = await this.provider.tokens();
    if (!tokens?.access_token) {
      throw new McpSessionNotConnectedError();
    }
    const transport = this.createTransport(
      new URL(ROBINHOOD_TRADING_MCP_URL),
      tokens.access_token,
    );
    const client = new Client(
      { name: 'rh-agent-mcp', version: '1.0.0' },
      { capabilities: {} },
    );
    this.transport = transport;
    this.client = client;

    try {
      await client.connect(transport);
    } catch (error) {
      this.client = undefined;
      this.transport = undefined;
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  async getToolDefinitions(): Promise<McpToolDefinition[]> {
    if (!this.client) throw new McpSessionNotConnectedError();
    const { tools } = await this.client.listTools();
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.client) throw new McpSessionNotConnectedError();
    return await this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;
    if (client) { await client.close(); return; }
    await transport?.close();
  }
}
```

The default transport factory:

```ts
function createRobinhoodTransport(serverUrl: URL, accessToken: string): Transport {
  return new StreamableHTTPClientTransport(serverUrl, {
    requestInit: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
```

### Connection helper for tool calls

`functions/src/rh-agent-mcp/auth/robinhood-mcp-connection.ts`:

```ts
export async function connectLocalRobinhoodMcpSession(
  options: ConnectLocalRobinhoodMcpSessionOptions = {},
): Promise<ConnectedRobinhoodMcpSession> {
  const repository = options.repository ?? createLocalCredentialRepository();
  const provider = new RepositoryOAuthProvider(repository, {
    redirectUrl: 'http://127.0.0.1:0/callback',
    openAuthorizationUrl: async () => {
      throw new RobinhoodMcpConnectionError(
        'No stored Robinhood credential. Run the local OAuth bootstrap first.',
      );
    },
  });

  const bundle = await provider.currentBundle();
  const now = options.now ?? new Date();
  const refreshPolicy = new DefaultTokenRefreshPolicy();

  if (!bundle?.tokens) throw new RobinhoodMcpConnectionError('No stored Robinhood credential. Run the local OAuth bootstrap first.');

  if (refreshPolicy.shouldRefresh(bundle, now, false)) {
    try {
      await refreshStoredCredential(provider, { now });
    } catch (error) {
      const { state } = classifyAuthenticationError(error);
      throw new RobinhoodMcpConnectionError(`Failed to refresh stored Robinhood credential: ${state}. Re-run the local OAuth bootstrap.`);
    }
  }

  const session = new RobinhoodMcpSession(provider, options.transportFactory);
  await session.connect();
  return { session, close: async () => { await session.close().catch(() => undefined); } };
}
```

### Tool catalog and allowlist

`functions/src/rh-agent-mcp/tools/robinhood-tools.ts`:

```ts
export type RobinhoodToolName =
  | 'get_accounts'
  | 'get_portfolio'
  | 'get_equity_positions'
  | 'get_equity_quotes'
  | 'get_equity_orders'
  | 'get_equity_fundamentals'
  | 'get_equity_historicals';

const OBSERVATION_ALLOWLIST = new Set<RobinhoodToolName>([...]);

export function isObservationTool(name: string): name is RobinhoodToolName {
  return OBSERVATION_ALLOWLIST.has(stripServerPrefix(name) as RobinhoodToolName);
}

export function toServerToolName(name: string): string {
  if (name.startsWith(SERVER_NAME_PREFIX)) return name;
  return SERVER_NAME_PREFIX + name;
}
```

### Tool executor

`functions/src/rh-agent-mcp/tools/robinhood-tool-executor.ts`:

```ts
export async function executeObservationTool(
  toolName: string,
  args: unknown,
  redactionOptions: RedactionOptions = {},
  options: ExecuteObservationToolOptions = {},
): Promise<ToolExecutionResult | ToolExecutionError> {
  if (!isObservationTool(toolName)) {
    return { success: false, error: `Tool "${toolName}" is not in the observation allowlist.`, category: ToolExecutionErrorCategory.VALIDATION };
  }

  const definition = await getObservationToolDefinition(toolName);
  if (!definition) {
    return { success: false, error: `Tool "${toolName}" is not in the observation allowlist.`, category: ToolExecutionErrorCategory.VALIDATION };
  }

  if (!isPlainObject(args)) {
    return { success: false, error: 'Tool arguments must be a JSON object.', category: ToolExecutionErrorCategory.VALIDATION };
  }

  const connection = await connectLocalRobinhoodMcpSession({
    transportFactory: options.transportFactory,
    repository: options.repository,
  });

  try {
    const mcpResult = await connection.session.callTool(toServerToolName(toolName), args);
    const parsed = parseToolResult(mcpResult);
    return {
      success: true,
      parsed,
      redacted: redactResponse(parsed ?? mcpResult, redactionOptions),
      tool: toolName,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      category: categorizeExecutionError(error),
    };
  } finally {
    await connection.close();
  }
}
```

### Response redaction

`functions/src/rh-agent-mcp/tools/robinhood-response-redactor.ts`:

```ts
const DEFAULT_SENSITIVE_FIELDS = new Set<string>([
  'account_number', 'account_number_masked', 'account_numbers', 'ssn', 'tin',
  'social_security_number', 'taxpayer_id', 'first_name', 'last_name', 'full_name',
  'legal_name', 'phone_number', 'email', 'email_address', 'address', 'street_address',
  'city', 'zip', 'zip_code', 'postal_code', 'date_of_birth', 'dob',
]);

const DEFAULT_SENSITIVE_PATTERNS = [
  /_account_number$/,
  /_account_numbers$/,
  /_id$/,       // e.g. trade_id, request_id
  /_uuid$/,     // e.g. request_uuid
  /_url$/,      // e.g. callback_url
  /^id$/, /^uuid$/, /^url$/,
];

export function redactResponse(response: unknown, options: RedactionOptions = {}): unknown {
  return redactValue(undefined, response, options, false);
}
```

### Local API

`functions/src/rh-agent-mcp/local-api/robinhood-observation-api.ts`:

```ts
const PORT = Number(process.env.RH_OBSERVATION_API_PORT ?? 3456);
const HOST = process.env.RH_OBSERVATION_API_HOST ?? '127.0.0.1';
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

const routes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/api\/rh\/tools$/,
    handler: async (_request, response) => handleListTools(response),
  },
  {
    method: 'POST',
    pattern: /^\/api\/rh\/tools\/([^/]+)$/,
    handler: async (request, response, match) =>
      handleExecuteTool(request, response, match[1]!),
  },
];

export function createRobinhoodObservationApi() {
  return createServer(async (request, response) => {
    if (isNotLocalEnvironment()) {
      sendJson(response, 403, { success: false, error: 'Observation API is only available in local development.' });
      return;
    }

    if (!isLoopback(request.socket.remoteAddress)) {
      sendJson(response, 403, { success: false, error: 'Observation API is only available from localhost.' });
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? HOST}`);
    const route = routes.find((r) => r.method === request.method && r.pattern.test(url.pathname));
    if (!route) {
      sendJson(response, 404, { success: false, error: 'Not found' });
      return;
    }

    const match = route.pattern.exec(url.pathname);
    try { await route.handler(request, response, match!); }
    catch (error) {
      console.error('Observation API unhandled error:', error);
      sendJson(response, 500, { success: false, error: 'Internal server error' });
    }
  });
}
```

### How to run it

From the repo root:

```powershell
# 1. Install dependencies
npm install
npm --prefix functions install

# 2. Bootstrap OAuth (interactive; opens browser)
npm --prefix functions run probe:rh-agent-mcp-auth

# 3. Run a single observation tool
npm --prefix functions run probe:rh-agent-mcp-tool -- get_accounts

# 4. Run the local API server
npm --prefix functions run serve:observation
```

Environment variables:

- `RH_OBSERVATION_API_PORT` — local API port (default `3456`).
- `RH_OBSERVATION_API_HOST` — local API host (default `127.0.0.1`); non-loopback is rejected.
- `RH_AGENT_FORCE_REFRESH` — force a token refresh during bootstrap.

### Reproduction checklist

1. Add `@modelcontextprotocol/sdk` to the backend project.
2. Provide an encrypted credential store that implements `OAuthClientProvider` and supports load/store/delete with concurrency control.
3. On Windows use DPAPI; on other platforms replace `DpapiCredentialCipher` with an equivalent secret-safe cipher (Keychain, Keyring, etc.).
4. Implement a local OAuth callback server that validates `state` with constant-time comparison and returns the `code` to the bootstrap runner.
5. Implement a browser opener (`rundll32`/`open`/`xdg-open`) or provide a way for the user to paste the authorization URL.
6. Store the full `OAuthTokens`, `OAuthClientInformationMixed`, and `OAuthDiscoveryState` returned by the SDK so refresh can happen later.
7. Implement a refresh policy; Robinhood access tokens expire quickly, so refresh 60 seconds before expiry.
8. Wrap `Client` + `StreamableHTTPClientTransport` from the MCP SDK in a session class that opens/closes per tool call.
9. Pre-fix or strip the server tool name (`mcp__robinhood-trading__` in this implementation) as needed for the upstream server.
10. Maintain a read-only allowlist and reject mutation tools at the API boundary.
11. Parse the MCP tool result (`content[0].text` JSON) and redact PII before returning it to the caller.
12. If exposing an HTTP API, bind to loopback only, cap request bodies, and validate the tool name/extra-redaction fields.

### Security notes from the current implementation

- The credential file lives on the local developer machine and is encrypted with the Windows user profile (DPAPI `CurrentUser` scope). It is never uploaded to Firebase or committed.
- The local API is blocked from production and non-loopback origins.
- Raw account numbers are only returned in the `parsed` field; the default display field is `redacted`.
- Each tool call opens and closes a fresh MCP session; there is no long-lived connection holding the access token.
