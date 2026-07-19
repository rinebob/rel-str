import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { type RobinhoodToolDefinition } from '@rh-agent-mcp/contracts';

const TOOL_CATALOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.rh-mcp-tool-catalog.json',
);

export type RobinhoodToolName =
  | 'get_accounts'
  | 'get_portfolio'
  | 'get_equity_positions'
  | 'get_equity_quotes'
  | 'get_equity_orders'
  | 'get_equity_fundamentals'
  | 'get_equity_historicals';

const MUTATION_TOOL_NAMES = new Set<string>([
  'add_option_to_watchlist',
  'add_to_watchlist',
  'cancel_equity_order',
  'cancel_option_order',
  'create_scan',
  'create_watchlist',
  'delete_scan',
  'delete_watchlist',
  'edit_watchlist_items',
  'follow_watchlist',
  'place_equity_order',
  'place_option_order',
  'preview_equity_order',
  'preview_option_order',
  'remove_option_from_watchlist',
  'remove_from_watchlist',
  'unfollow_watchlist',
  'update_watchlist',
]);

const OBSERVATION_ALLOWLIST = new Set<RobinhoodToolName>([
  'get_accounts',
  'get_portfolio',
  'get_equity_positions',
  'get_equity_quotes',
  'get_equity_orders',
  'get_equity_fundamentals',
  'get_equity_historicals',
]);

const SERVER_NAME_PREFIX = 'mcp__robinhood-trading__';

function stripServerPrefix(name: string): string {
  return name.startsWith(SERVER_NAME_PREFIX)
    ? name.slice(SERVER_NAME_PREFIX.length)
    : name;
}

export function toServerToolName(name: string): string {
  if (name.startsWith(SERVER_NAME_PREFIX)) {
    return name;
  }
  return SERVER_NAME_PREFIX + name;
}

interface ToolCatalog {
  generated: string;
  source: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
}

let cachedCatalog: ToolCatalog | undefined;

export async function loadToolCatalog(): Promise<ToolCatalog> {
  if (cachedCatalog) {
    return cachedCatalog;
  }
  const raw = await readFile(TOOL_CATALOG_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as ToolCatalog;
  if (!Array.isArray(parsed.tools)) {
    throw new Error('Tool catalog is missing tools array');
  }
  cachedCatalog = parsed;
  return parsed;
}

export function isObservationTool(name: string): name is RobinhoodToolName {
  return OBSERVATION_ALLOWLIST.has(stripServerPrefix(name) as RobinhoodToolName);
}

export function isMutationTool(name: string): boolean {
  return MUTATION_TOOL_NAMES.has(stripServerPrefix(name));
}

export async function listObservationTools(): Promise<RobinhoodToolDefinition[]> {
  const catalog = await loadToolCatalog();
  return catalog.tools
    .map((tool) => ({ ...tool, serverName: stripServerPrefix(tool.name) }))
    .filter((tool) => isObservationTool(tool.serverName))
    .map((tool) => ({
      name: tool.serverName as RobinhoodToolName,
      description: tool.description,
      inputSchema: tool.inputSchema,
      mutation: isMutationTool(tool.serverName),
    }));
}

export async function getObservationToolDefinition(
  name: string,
): Promise<RobinhoodToolDefinition | undefined> {
  const shortName = stripServerPrefix(name) as RobinhoodToolName;
  const tools = await listObservationTools();
  return tools.find((tool) => tool.name === shortName);
}
