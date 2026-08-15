/**
 * Firebase Cloud Function: discover RH MCP option-quote tool shapes.
 *
 * Exercises the read-only option tool chain from the cloud to capture
 * response shapes for:
 *   - get_option_chains
 *   - get_option_instruments
 *   - get_option_quotes
 *
 * Returns raw (but trimmed) response samples plus structural summaries.
 * No account numbers, tokens, or PII are present in these option-market
 * responses, so redaction is unnecessary for owner-only discovery.
 *
 * Deploy:
 *   firebase functions:secrets:set RH_CREDENTIAL_BUNDLE < <bundle-path>
 *   firebase deploy --only functions:rhOptionQuoteDiscovery
 *
 * Invoke (owner-only):
 *   curl <function-url>
 *
 * Optional query params:
 *   ?symbol=SPY — underlying symbol to query (default: SPY)
 */
import { onRequest } from 'firebase-functions/v2/https';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { connectLocalRobinhoodMcpSession } from '../auth/robinhood-mcp-connection';
import { PortableFileCredentialRepository } from '../auth/portable-file-credential-repository';
import { executeObservationTool } from '../tools/robinhood-tool-executor';
import { getObservationToolDefinition } from '../tools/robinhood-tools';

interface ToolAttempt {
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  error?: string;
  category?: string;
  shape?: Record<string, unknown>;
  sample?: unknown;
}

function takeSample(value: unknown, maxArrayItems = 3, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const sampled = value.slice(0, maxArrayItems);
    return depth < 3 ? sampled.map((item) => takeSample(item, maxArrayItems, depth + 1)) : sampled;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sample: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      sample[key] = depth < 3 ? takeSample(obj[key], maxArrayItems, depth + 1) : obj[key];
    }
    return sample;
  }
  return value;
}

function summarizeShape(value: unknown, depth = 0): Record<string, unknown> {
  if (value === null || value === undefined) return { type: String(value) };
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return { type: typeof value };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'array', length: 0 };
    return {
      type: 'array',
      length: value.length,
      itemShape: depth < 3 ? summarizeShape(value[0], depth + 1) : { type: 'nested' },
    };
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      fields[key] = depth < 3 ? summarizeShape(obj[key], depth + 1) : { type: 'nested' };
    }
    return { type: 'object', fields };
  }
  return { type: typeof value };
}

export const rhOptionQuoteDiscovery = onRequest(
  { secrets: ['RH_CREDENTIAL_BUNDLE'], timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    const bundleJson = process.env.RH_CREDENTIAL_BUNDLE;
    if (!bundleJson) {
      res.status(500).json({ success: false, error: 'RH_CREDENTIAL_BUNDLE secret not set' });
      return;
    }

    const symbol = (req.query.symbol as string) || 'SPY';
    const tmpPath = join(tmpdir(), `rh-credential-${randomUUID()}.json`);

    const attempts: ToolAttempt[] = [];
    const schemas: Record<string, unknown> = {};

    try {
      await writeFile(tmpPath, bundleJson, { encoding: 'utf8', mode: 0o600 });
      const repository = new PortableFileCredentialRepository(tmpPath);
      const bundle = await repository.load();

      if (!bundle?.tokens) {
        res.status(500).json({ success: false, error: 'No tokens in credential bundle' });
        return;
      }

      // Capture schemas first so we know what args each tool expects.
      for (const toolName of ['get_option_instruments', 'get_option_quotes']) {
        const definition = await getObservationToolDefinition(toolName);
        schemas[toolName] = definition
          ? { found: true, inputSchema: definition.inputSchema }
          : { found: false };
      }

      const connection = await connectLocalRobinhoodMcpSession({ repository });
      try {
        // 1. Chains: get expirations/chain identifiers.
        const chainsResult = await executeObservationTool(
          'get_option_chains',
          { underlying_symbol: symbol },
          {},
          { repository },
        );

        if (!chainsResult.success) {
          res.status(500).json({
            success: false,
            proof: 'chains_failed',
            symbol,
            error: chainsResult.error,
            category: chainsResult.category,
          });
          return;
        }

        const parsedChains = chainsResult.parsed as Record<string, unknown> | undefined;
        const chainsArray =
          (parsedChains?.data as Record<string, unknown> | undefined)?.chains ??
          (Array.isArray(parsedChains?.data) ? parsedChains?.data : undefined);
        const firstChain = Array.isArray(chainsArray) && chainsArray.length > 0
          ? (chainsArray[0] as Record<string, unknown>)
          : undefined;

        attempts.push({
          tool: 'get_option_chains',
          args: { underlying_symbol: symbol },
          success: true,
          shape: summarizeShape(parsedChains ?? chainsArray),
        });

        if (!firstChain) {
          res.json({
            success: true,
            proof: 'discovery_partial',
            symbol,
            schemas,
            attempts,
            note: 'No chain entries found; cannot probe instruments/quotes.',
          });
          return;
        }

        // Common keys seen in RH chain objects.
        const chainId =
          firstChain.chain_id ?? firstChain.id ?? firstChain.chainId ?? firstChain.symbol ?? symbol;
        const expirationDate =
          firstChain.expiration_date ?? firstChain.expirationDate ?? firstChain.expiration ?? firstChain.date;

        // 2. Instruments: try common argument patterns.
        const instrumentArgPatterns: Record<string, unknown>[] = [
          { chain_id: chainId },
          { underlying_symbol: symbol, expiration_date: expirationDate },
          { symbol, expiration_date: expirationDate },
          { chain_id: chainId, expiration_date: expirationDate },
          { underlying_symbol: symbol },
        ];

        let instrumentIds: string[] | undefined;
        let instrumentSuccessArgs: Record<string, unknown> | undefined;
        let instrumentShape: Record<string, unknown> | undefined;

        for (const args of instrumentArgPatterns) {
          const result = await executeObservationTool(
            'get_option_instruments',
            args,
            {},
            { repository },
          );
          attempts.push({
            tool: 'get_option_instruments',
            args: takeSample(args) as Record<string, unknown>,
            success: result.success,
            ...(result.success
              ? { shape: summarizeShape(result.parsed), sample: takeSample(result.parsed) }
              : { error: result.error, category: result.category }),
          });

          if (result.success) {
            instrumentSuccessArgs = args;
            instrumentShape = summarizeShape(result.parsed);
            const parsed = result.parsed as Record<string, unknown> | undefined;
            const data = parsed?.data as Record<string, unknown> | undefined;
            const options =
              (data?.options as unknown[]) ??
              (data?.instruments as unknown[]) ??
              (Array.isArray(data) ? data : undefined);
            if (Array.isArray(options)) {
              const ids: string[] = [];
              for (const opt of options.slice(0, 5)) {
                const obj = opt as Record<string, unknown>;
                const id =
                  obj.id ?? obj.instrument_id ?? obj.instrumentId ?? obj.option_id ?? obj.optionId;
                if (typeof id === 'string') ids.push(id);
              }
              if (ids.length > 0) {
                instrumentIds = ids;
                break;
              }
            }
          }
        }

        // 3. Quotes: try common argument patterns if we have instrument IDs.
        if (instrumentIds && instrumentIds.length > 0) {
          const quoteArgPatterns: Record<string, unknown>[] = [
            { instrument_ids: instrumentIds },
            { option_ids: instrumentIds },
            { instrument_id: instrumentIds[0] },
            { option_id: instrumentIds[0] },
            { instrument_ids: instrumentIds.slice(0, 1) },
          ];

          for (const args of quoteArgPatterns) {
            const result = await executeObservationTool(
              'get_option_quotes',
              args,
              {},
              { repository },
            );
            attempts.push({
              tool: 'get_option_quotes',
              args: takeSample(args) as Record<string, unknown>,
              success: result.success,
              ...(result.success
                ? { shape: summarizeShape(result.parsed), sample: takeSample(result.parsed) }
                : { error: result.error, category: result.category }),
            });
            if (result.success) break;
          }
        }

        res.json({
          success: true,
          proof: 'discovery_complete',
          symbol,
          credentialRevision: bundle.revision,
          schemas,
          chains: {
            count: Array.isArray(chainsArray) ? chainsArray.length : 0,
            firstChainShape: summarizeShape(firstChain),
          },
          instruments: instrumentSuccessArgs
            ? {
                successArgs: takeSample(instrumentSuccessArgs),
                shape: instrumentShape,
              }
            : { success: false },
          attempts,
        });
      } finally {
        await connection.close().catch(() => undefined);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        proof: 'discovery_connection_failed',
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await rm(tmpPath, { force: true }).catch(() => undefined);
    }
  },
);
