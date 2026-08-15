/**
 * Diagnostic: prove a locally-bootstrapped Robinhood credential bundle can
 * be used outside the DPAPI cipher to connect to the Robinhood MCP and make
 * a read-only call.
 *
 * This is the local half of the Phase 4 cloud-read proof. It uses
 * PortableFileCredentialRepository (no DPAPI, no Windows dependency) to load
 * the exported bundle, then calls connectLocalRobinhoodMcpSession with that
 * repository — the same code path a Firebase Function would take.
 *
 * Usage:
 *   npx tsx src/rh-agent-mcp/diagnostics/run-cloud-credential-proof.ts <bundle-path>
 *
 * The script:
 *   1. Loads the portable bundle
 *   2. Connects to the Robinhood MCP (refreshing if needed)
 *   3. Calls get_option_chains for SPY (read-only)
 *   4. Prints redacted structural evidence (no tokens, no account data)
 */
import { connectLocalRobinhoodMcpSession } from '../auth/robinhood-mcp-connection';
import { PortableFileCredentialRepository } from '../auth/portable-file-credential-repository';
import { executeObservationTool } from '../tools/robinhood-tool-executor';

async function main() {
  const bundlePath = process.argv[2];
  if (!bundlePath) {
    console.error('Usage: npx tsx src/rh-agent-mcp/diagnostics/run-cloud-credential-proof.ts <bundle-path>');
    process.exit(1);
  }

  const repository = new PortableFileCredentialRepository(bundlePath);
  const bundle = await repository.load();
  if (!bundle?.tokens) {
    console.error('No credential bundle found at', bundlePath);
    process.exit(1);
  }

  console.log('loaded_bundle', {
    revision: bundle.revision,
    hasAccessToken: Boolean(bundle.tokens.access_token),
    hasRefreshToken: Boolean(bundle.tokens.refresh_token),
    expiresIn: bundle.tokens.expires_in,
    lastTokenResponseAt: bundle.lastTokenResponseAt,
  });

  // Connect using the portable repository — no DPAPI involved.
  console.log('connecting_to_robinhood_mcp...');
  const connection = await connectLocalRobinhoodMcpSession({ repository });

  try {
    // Read-only proof call: get_option_chains for SPY.
    console.log('calling get_option_chains...');
    const result = await executeObservationTool(
      'get_option_chains',
      { underlying_symbol: 'SPY' },
      {},
      { repository },
    );

    if (result.success) {
      const parsed = result.parsed as { data?: { chains?: unknown[] } } | undefined;
      const chainCount = parsed?.data?.chains?.length ?? 0;
      console.log('cloud_credential_proof_success', {
        tool: result.tool,
        chainCount,
        hasData: Boolean(parsed?.data),
      });
    } else {
      console.error('cloud_credential_proof_tool_error', {
        error: result.error,
        category: result.category,
      });
      process.exit(1);
    }
  } finally {
    await connection.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('cloud_credential_proof_failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
