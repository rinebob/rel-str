import { readFile } from 'node:fs/promises';
import { executeObservationTool } from '../tools/robinhood-tool-executor';

async function main() {
  const [toolName, argsPath, ...extraRedactFields] = process.argv.slice(2);

  if (!toolName) {
    console.error('Usage: npx tsx src/rh-agent-mcp/diagnostics/run-tool-observation.ts <toolName> [args-json-path] [extraRedactField...]');
    process.exit(1);
  }

  let args: Record<string, unknown> = {};
  if (argsPath) {
    const raw = await readFile(argsPath, 'utf-8');
    args = JSON.parse(raw) as Record<string, unknown>;
  }

  const result = await executeObservationTool(toolName, args, {
    extraFields: extraRedactFields,
  });

  if (result.success) {
    console.log(JSON.stringify(result.redacted, null, 2));
  } else {
    console.error(result.error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
