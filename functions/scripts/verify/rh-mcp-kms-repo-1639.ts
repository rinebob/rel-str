/**
 * Verifies the #1639 rewire against the REAL environment — no mocks:
 *   1. createKmsCredentialRepository → rh-agent-credentials/bundle → KMS
 *      decrypt → structurally valid bundle (revision, lastTokenResponseAt,
 *      token/client/discovery presence — values are never printed)
 *   2. --connect: the full pass path — session-manager factory → refresh
 *      (with durable rotation persisting to the doc) → one real read-only
 *      MCP call (get_option_chains SPY — the canary's probe). A refresh that
 *      rotates the grant bumps the doc revision — printed before/after as
 *      direct evidence that rotation now survives the rotating process.
 *
 * Read-only w.r.t. the doc unless --connect triggers a refresh — that write
 * is the intended production behavior this task ships, not scratch data.
 *
 * Usage:
 *   cd functions
 *   $env:RH_CREDENTIAL_KEY_NAME="projects/<p>/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials"
 *   npx tsx scripts/verify/rh-mcp-kms-repo-1639.ts [--connect]
 */
import '../../src/firebase-admin-init'; // side-effect: initializes the default app for getFirestore()
import { createKmsCredentialRepository } from '../../src/rh-agent-mcp/auth/production-credential-repository';
import { createRobinhoodMcpSessionManagerFromKms } from '../../src/options-strategy-engine/mcp/robinhood-mcp-session-manager';
import { withTimeout } from '../../src/rh-agent-mcp/tools/session-acquisition';
import { MCP_CALL_TIMEOUT_MS } from '../../src/rh-agent-mcp/tools/robinhood-tool-executor';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  const connect = process.argv.includes('--connect');
  if (!process.env.RH_CREDENTIAL_KEY_NAME) {
    console.error('RH_CREDENTIAL_KEY_NAME is not set — see scripts/verify/rh-mcp-kms-repo-1639.md');
    process.exit(2);
  }

  const repository = createKmsCredentialRepository();
  console.log('== credential doc (rh-agent-credentials/bundle) ==');
  const before = await repository.load();
  check('bundle doc loads through the production factory', before !== null);
  if (!before) process.exit(1);
  check('schemaVersion is 1', before.schemaVersion === 1, `got ${before.schemaVersion}`);
  console.log(`  revision:            ${before.revision}`);
  console.log(`  lastTokenResponseAt: ${before.lastTokenResponseAt ?? '(unset)'}`);
  check('tokens.access_token present', !!before.tokens?.access_token);
  check('tokens.refresh_token present', !!before.tokens?.refresh_token);
  check('clientInformation present', before.clientInformation !== undefined);
  check('discoveryState present', before.discoveryState !== undefined);

  if (connect) {
    console.log('== session connect + probe (real refresh → MCP call) ==');
    const manager = await createRobinhoodMcpSessionManagerFromKms({ repository });
    const started = Date.now();
    try {
      const result = await withTimeout(
        manager.callTool('get_option_chains', { underlying_symbol: 'SPY' }),
        MCP_CALL_TIMEOUT_MS,
        'verify-1639 probe',
      );
      check('get_option_chains(SPY) returned data', result !== undefined);
      console.log(`  probe latency: ${Date.now() - started}ms`);
    } finally {
      await manager.close().catch(() => undefined);
    }
    const after = await repository.load();
    console.log(`  revision after: ${after?.revision}`);
    console.log(`  lastTokenResponseAt after: ${after?.lastTokenResponseAt ?? '(unset)'}`);
    if (after && after.lastTokenResponseAt !== before.lastTokenResponseAt) {
      console.log('  REFRESH OCCURRED — new tokens persisted to the doc');
      if (after.revision > before.revision) {
        console.log('  grant rotated — revision bumped and persisted (the #1639 fix working as designed)');
      }
    } else {
      console.log('  no refresh needed this run — rotation persistence is verified on the first expiry-driven refresh');
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exit(1);
});
