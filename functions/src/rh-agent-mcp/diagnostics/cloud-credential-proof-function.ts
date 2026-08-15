/**
 * Firebase Cloud Function: prove a locally-bootstrapped Robinhood credential
 * works from a cloud IP.
 *
 * This is the Phase 4 cloud-read proof from RH-AGENT-DIRECT-MCP-AUTH-PROOF.
 * It reads the exported credential bundle from the RH_CREDENTIAL_BUNDLE secret,
 * writes it to a temp file, and uses PortableFileCredentialRepository + the
 * existing connection flow to call get_option_chains.
 *
 * Deploy:
 *   firebase functions:secrets:set RH_CREDENTIAL_BUNDLE < <bundle-path>
 *   firebase deploy --only functions:rhCloudCredentialProof
 *
 * Invoke (owner-only):
 *   curl <function-url>
 *
 * Returns redacted structural evidence only — no tokens, no account data.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { connectLocalRobinhoodMcpSession } from '../auth/robinhood-mcp-connection';
import { PortableFileCredentialRepository } from '../auth/portable-file-credential-repository';
import { executeObservationTool } from '../tools/robinhood-tool-executor';

export const rhCloudCredentialProof = onRequest(
  { secrets: ['RH_CREDENTIAL_BUNDLE'], timeoutSeconds: 30 },
  async (req, res) => {
    const bundleJson = process.env.RH_CREDENTIAL_BUNDLE;
    if (!bundleJson) {
      res.status(500).json({ success: false, error: 'RH_CREDENTIAL_BUNDLE secret not set' });
      return;
    }

    const tmpPath = join(tmpdir(), `rh-credential-${randomUUID()}.json`);
    try {
      await writeFile(tmpPath, bundleJson, { encoding: 'utf8', mode: 0o600 });
      const repository = new PortableFileCredentialRepository(tmpPath);
      const bundle = await repository.load();

      if (!bundle?.tokens) {
        res.status(500).json({ success: false, error: 'No tokens in credential bundle' });
        return;
      }

      const connection = await connectLocalRobinhoodMcpSession({ repository });
      try {
        const result = await executeObservationTool(
          'get_option_chains',
          { underlying_symbol: 'SPY' },
          {},
          { repository },
        );

        if (result.success) {
          const parsed = result.parsed as { data?: { chains?: unknown[] } } | undefined;
          res.json({
            success: true,
            proof: 'cloud_credential_read_succeeded',
            tool: result.tool,
            chainCount: parsed?.data?.chains?.length ?? 0,
            credentialRevision: bundle.revision,
          });
        } else {
          res.status(500).json({
            success: false,
            proof: 'cloud_credential_tool_failed',
            error: result.error,
            category: result.category,
          });
        }
      } finally {
        await connection.close().catch(() => undefined);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        proof: 'cloud_credential_connection_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await rm(tmpPath, { force: true }).catch(() => undefined);
    }
  },
);
