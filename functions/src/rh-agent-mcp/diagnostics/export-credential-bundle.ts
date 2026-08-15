/**
 * Diagnostic: decrypt the local DPAPI credential bundle and write it as
 * portable JSON to a caller-specified path (use a temp directory, NOT the repo).
 *
 * This proves the credential bundle is readable outside the DPAPI cipher and
 * produces the exact shape a cloud credential repository would need to consume.
 *
 * Usage:
 *   npx tsx src/rh-agent-mcp/diagnostics/export-credential-bundle.ts <output-path>
 *
 * The output file contains live OAuth tokens. Never commit it, never log it,
 * and delete it after the cloud proof is complete.
 */
import { writeFile } from 'node:fs/promises';
import { createLocalCredentialRepository } from '../auth/local-credential-repository';

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    console.error('Usage: npx tsx src/rh-agent-mcp/diagnostics/export-credential-bundle.ts <output-path>');
    process.exit(1);
  }

  const repository = createLocalCredentialRepository();
  const bundle = await repository.load();

  if (!bundle?.tokens) {
    console.error('No stored Robinhood credential found. Run the local OAuth bootstrap first.');
    process.exit(1);
  }

  // Redact token values in the console output — only show structural fields.
  console.log('exported_bundle_shape', {
    schemaVersion: bundle.schemaVersion,
    revision: bundle.revision,
    hasAccessToken: Boolean(bundle.tokens.access_token),
    hasRefreshToken: Boolean(bundle.tokens.refresh_token),
    tokenType: bundle.tokens.token_type,
    expiresIn: bundle.tokens.expires_in,
    scope: bundle.tokens.scope,
    hasClientInformation: Boolean(bundle.clientInformation),
    hasDiscoveryState: Boolean(bundle.discoveryState),
    lastTokenResponseAt: bundle.lastTokenResponseAt,
  });

  await writeFile(outputPath, JSON.stringify(bundle, null, 2), { encoding: 'utf8', mode: 0o600 });
  console.log(`Credential bundle written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
