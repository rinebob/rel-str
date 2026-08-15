/**
 * Diagnostic: probe the Robinhood MCP rate limit by making rapid sequential
 * get_option_quotes calls and recording timing + any throttling/errors.
 *
 * Usage:
 *   npx tsx src/rh-agent-mcp/diagnostics/run-rate-limit-probe.ts [count] [delayMs]
 *
 * Defaults: 50 calls, 0ms delay (as fast as possible).
 * Prints a summary at the end: call count, success/fail, latencies, any errors.
 */
import { executeObservationTool } from '../tools/robinhood-tool-executor';

interface ProbeResult {
  index: number;
  success: boolean;
  latencyMs: number;
  error?: string;
  category?: string;
  chainCount?: number;
}

async function main() {
  const count = Number(process.argv[2] ?? 50);
  const delayMs = Number(process.argv[3] ?? 0);

  // Use the SPY chain call we already verified works.
  const args = { underlying_symbol: 'SPY' };
  const results: ProbeResult[] = [];
  const startTime = Date.now();

  console.log(`rate_limit_probe_start`, { count, delayMs, tool: 'get_option_chains' });

  for (let i = 0; i < count; i++) {
    const callStart = Date.now();
    const result = await executeObservationTool('get_option_chains', args, {});
    const latencyMs = Date.now() - callStart;

    const probeResult: ProbeResult = {
      index: i,
      success: result.success,
      latencyMs,
    };

    if (result.success) {
      const parsed = result.parsed as { data?: { chains?: unknown[] } } | undefined;
      probeResult.chainCount = parsed?.data?.chains?.length ?? 0;
    } else {
      probeResult.error = result.error;
      probeResult.category = result.category;
    }

    results.push(probeResult);

    // Log every 10 calls or on error.
    if (i % 10 === 9 || !result.success) {
      console.log(`call_${i + 1}`, {
        latencyMs,
        success: result.success,
        ...(probeResult.error ? { error: probeResult.error, category: probeResult.category } : {}),
      });
    }

    if (!result.success) {
      console.log(`rate_limit_probe_stopped_early`, {
        callIndex: i,
        totalCalls: i + 1,
        error: result.error,
        category: result.category,
      });
      break;
    }

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const totalElapsedMs = Date.now() - startTime;
  const successes = results.filter((r) => r.success);
  const failures = results.filter((r) => !r.success);
  const latencies = successes.map((r) => r.latencyMs);
  const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const effectiveRatePerMin = successes.length > 0 ? Math.round((successes.length / totalElapsedMs) * 60_000) : 0;

  console.log(`rate_limit_probe_summary`, {
    totalCalls: results.length,
    successes: successes.length,
    failures: failures.length,
    totalElapsedMs,
    effectiveRatePerMin,
    minLatencyMs: minLatency,
    maxLatencyMs: maxLatency,
    avgLatencyMs: avgLatency,
    firstError: failures[0]?.error,
    firstErrorCategory: failures[0]?.category,
    firstErrorIndex: failures[0]?.index,
  });
}

main().catch((error) => {
  console.error('rate_limit_probe_failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
