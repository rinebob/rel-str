import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { type RobinhoodToolDefinition } from '@robinhood-mcp/contracts';
import toolCatalogJson from '../../../.rh-mcp-tool-catalog.json' with { type: 'json' };

const TOOL_CATALOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.rh-mcp-tool-catalog.json',
);

const SERVER_NAME_PREFIX = 'mcp__robinhood-trading__';

// Domain groups — the only permanent organization; rollout phases are an implementation detail.
const ACCOUNT_AND_PERFORMANCE_TOOLS = new Set<string>([
  'get_accounts',
  'get_portfolio',
  'get_equity_positions',
  'get_equity_tax_lots',
  'get_pnl_trade_history',
  'get_realized_pnl',
  'get_limited_margin_upgrade_info',
]);

const MARKET_DATA_AND_RESEARCH_TOOLS = new Set<string>([
  'search',
  'get_equity_quotes',
  'get_equity_fundamentals',
  'get_equity_historicals',
  'get_equity_price_book',
  'get_financials',
  'get_earnings_calendar',
  'get_earnings_results',
  'get_equity_technical_indicators',
  'get_equity_tradability',
  'get_indexes',
  'get_index_quotes',
  'get_index_historicals',
  'get_equity_analyst_ratings',
  'get_politician_trades',
]);

const OPTIONS_TOOLS = new Set<string>([
  'get_option_chains',
  'get_option_instruments',
  'get_option_quotes',
  'get_option_positions',
  'get_option_level_upgrade_info',
  'get_option_watchlist',
  'get_option_historicals',
]);

const CRYPTO_TOOLS = new Set<string>([
  'get_crypto_account_onboarding_info',
  'get_crypto_orders',
  'get_crypto_positions',
  'get_crypto_quotes',
  'get_currency_pairs',
  'place_crypto_order',
  'cancel_crypto_order',
  'preview_crypto_order',
]);

const ALERT_TOOLS = new Set<string>([
  'get_alerts',
  'get_alert_log',
  'create_alert',
  'update_alert',
  'delete_alert',
  'mark_alerts_read',
]);

const SEC_FILING_TOOLS = new Set<string>([
  'get_sec_filing',
  'get_sec_filing_facts',
  'get_sec_filing_facts_catalog',
  'get_sec_filing_index',
]);

const SCANNER_TOOLS = new Set<string>([
  'get_scanner_filter_specs',
  'get_scans',
  'run_scan',
  'create_scan',
  'update_scan_config',
  'update_scan_filters',
  'get_scanner_datapoints',
  'preview_scan',
]);

const WATCHLIST_TOOLS = new Set<string>([
  'get_watchlists',
  'get_watchlist_items',
  'get_popular_watchlists',
  'create_watchlist',
  'update_watchlist',
  'add_to_watchlist',
  'remove_from_watchlist',
  'follow_watchlist',
  'unfollow_watchlist',
  'add_option_to_watchlist',
  'remove_option_from_watchlist',
]);

const ORDER_TOOLS = new Set<string>([
  'get_equity_orders',
  'get_option_orders',
  'review_equity_order',
  'review_option_order',
  'place_equity_order',
  'cancel_equity_order',
  'place_option_order',
  'cancel_option_order',
  'exercise_option',
  'cancel_option_exercise',
]);

const ALL_ENABLED_TOOLS = new Set<string>([
  ...ACCOUNT_AND_PERFORMANCE_TOOLS,
  ...MARKET_DATA_AND_RESEARCH_TOOLS,
  ...OPTIONS_TOOLS,
  ...CRYPTO_TOOLS,
  ...ALERT_TOOLS,
  ...SEC_FILING_TOOLS,
  ...SCANNER_TOOLS,
  ...WATCHLIST_TOOLS,
  ...ORDER_TOOLS,
]);

const TOOL_GROUPS: Array<[string, Set<string>]> = [
  ['Account & Performance', ACCOUNT_AND_PERFORMANCE_TOOLS],
  ['Market Data & Research', MARKET_DATA_AND_RESEARCH_TOOLS],
  ['Options', OPTIONS_TOOLS],
  ['Crypto', CRYPTO_TOOLS],
  ['Alerts', ALERT_TOOLS],
  ['SEC Filings', SEC_FILING_TOOLS],
  ['Scanners', SCANNER_TOOLS],
  ['Watchlists', WATCHLIST_TOOLS],
  ['Orders', ORDER_TOOLS],
];

const CATEGORY_BY_TOOL: Record<string, string> = {};
for (const [category, tools] of TOOL_GROUPS) {
  tools.forEach((name) => {
    CATEGORY_BY_TOOL[name] = category;
  });
}

export function stripServerPrefix(name: string): string {
  return name.startsWith(SERVER_NAME_PREFIX)
    ? name.slice(SERVER_NAME_PREFIX.length)
    : name;
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
  let parsed: ToolCatalog;
  try {
    const raw = await readFile(TOOL_CATALOG_PATH, 'utf-8');
    parsed = JSON.parse(raw) as ToolCatalog;
  } catch {
    // Fallback to the bundled import (needed when deployed as a bundle
    // without the catalog file on disk, e.g. Cloud Functions).
    parsed = toolCatalogJson as ToolCatalog;
  }
  if (!Array.isArray(parsed.tools)) {
    throw new Error('Tool catalog is missing tools array');
  }
  cachedCatalog = parsed;
  return parsed;
}

export function isObservationTool(name: string): boolean {
  return ALL_ENABLED_TOOLS.has(stripServerPrefix(name));
}

const MUTATION_TOOLS = new Set<string>([
  'create_scan',
  'update_scan_config',
  'update_scan_filters',
  'create_watchlist',
  'update_watchlist',
  'add_to_watchlist',
  'remove_from_watchlist',
  'follow_watchlist',
  'unfollow_watchlist',
  'add_option_to_watchlist',
  'remove_option_from_watchlist',
  'place_equity_order',
  'cancel_equity_order',
  'place_option_order',
  'cancel_option_order',
  'create_alert',
  'update_alert',
  'delete_alert',
  'mark_alerts_read',
  'place_crypto_order',
  'cancel_crypto_order',
  'exercise_option',
  'cancel_option_exercise',
]);

const SIMULATION_TOOLS = new Set<string>([
  'review_equity_order',
  'review_option_order',
  'preview_crypto_order',
  'preview_scan',
]);

const FINANCIAL_MUTATION_TOOLS = new Set<string>([
  'place_equity_order',
  'cancel_equity_order',
  'place_option_order',
  'cancel_option_order',
  'place_crypto_order',
  'cancel_crypto_order',
  'exercise_option',
  'cancel_option_exercise',
]);

export function isMutationTool(name: string): boolean {
  return MUTATION_TOOLS.has(stripServerPrefix(name));
}

export function isSimulationTool(name: string): boolean {
  return SIMULATION_TOOLS.has(stripServerPrefix(name));
}

export function isFinancialMutationTool(name: string): boolean {
  return FINANCIAL_MUTATION_TOOLS.has(stripServerPrefix(name));
}

export function getToolCategory(name: string): string | undefined {
  return CATEGORY_BY_TOOL[stripServerPrefix(name)];
}

let cachedObservationTools: RobinhoodToolDefinition[] | undefined;

export async function listObservationTools(): Promise<RobinhoodToolDefinition[]> {
  if (cachedObservationTools) {
    return cachedObservationTools;
  }
  const catalog = await loadToolCatalog();
  cachedObservationTools = catalog.tools
    .map((tool) => ({ ...tool, serverName: stripServerPrefix(tool.name) }))
    .filter((tool) => isObservationTool(tool.serverName))
    .map((tool) => {
      const shortName = tool.serverName;
      const mutation = isMutationTool(shortName);
      const simulation = isSimulationTool(shortName);
      const financialMutation = isFinancialMutationTool(shortName);
      return {
        name: shortName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        mutation,
        simulation,
        financialMutation,
        category: getToolCategory(shortName),
      };
    });
  return cachedObservationTools;
}

export async function getObservationToolDefinition(
  name: string,
): Promise<RobinhoodToolDefinition | undefined> {
  const shortName = stripServerPrefix(name);
  const tools = await listObservationTools();
  return tools.find((tool) => tool.name === shortName);
}
