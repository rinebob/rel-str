/**
 * Diagnostic: probe RH MCP throughput with session reuse.
 * Opens ONE session and makes N tool calls through it, vs the default
 * executeObservationTool which opens/closes a session per call.
 *
 * Usage:
 *   npx tsx src/rh-agent-mcp/diagnostics/run-rate-limit-probe-reuse.ts [count]
 */
import { connectLocalRobinhoodMcpSession } from '../auth/robinhood-mcp-connection';
import { isObservationTool, stripServerPrefix } from '../tools/robinhood-tools';

async function main() {
  const count = Number(process.argv[2] ?? 50);
  const toolName = 'get_option_chains';
  const args = { underlying_symbol: 'SPY' };

  if (!isObservationTool(toolName)) {
    console.error(`${toolName} is not an observation tool`);
    process.exit(1);
  }

  console.log(`rate_limit_probe_reuse_start`, { count, tool: toolName });

  const connectStart = Date.now();
  const connection = await connectLocalRobinhoodMcpSession({});
  const connectMs = Date.now() - connectStart;
  console.log(`session_connected`, { connectMs });

  const results: Array<{ index: number; success: boolean; latencyMs: number; error?: string }> = [];
  const callStart0 = Date.now();

  try {
    for (let i = 0; i < count; i++) {
      const callStart = Date.now();
      try {
        const shortName = stripServerPrefix(toolName);
        const mcpResult = await connection.session.callTool(shortName, args);
        const latencyMs = Date.now() - callStart;
        const hasContent = Array.isArray((mcpResult as { content?: unknown[] }).content);
        results.push({ index: i, success: hasContent, latencyMs });
        if (i % 10 === 9) {
          console.log(`call_${i + 1}`, { latencyMs, success: hasContent });
        }
      } catch (error) {
        const latencyMs = Date.now() - callStart;
        const msg = error instanceof Error ? error.message : String(error);
        results.push({ index: i, success: false, latencyMs, error: msg });
        console.log(`call_${i + 1}_error`, { latencyMs, error: msg });
        break;
      }
    }
  } finally {
    await connection.close().catch(() => undefined);
  }

  const totalCallMs = Date.now() - callStart0;
  const successes = results.filter((r) => r.success);
  const failures = results.filter((r) => !r.success);
  const latencies = successes.map((r) => r.latencyMs);
  const minLat = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLat = latencies.length > 0 ? Math.max(...latencies) : 0;
  const avgLat = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const effectiveRatePerMin = successes.length > 0 ? Math.round((successes.length / totalCallMs) * 60_000) : 0;

  console.log(`rate_limit_probe_reuse_summary`, {
    connectMs,
    totalCalls: results.length,
    successes: successes.length,
    failures: failures.length,
    totalCallMs,
    effectiveRatePerMin,
    minLatencyMs: minLat,
    maxLatencyMs: maxLat,
    avgLatencyMs: avgLat,
    firstError: failures[0]?.error,
    firstErrorIndex: failures[0]?.index,
  });
}

main().catch((error) => {
  console.error('rate_limit_probe_reuse_failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
