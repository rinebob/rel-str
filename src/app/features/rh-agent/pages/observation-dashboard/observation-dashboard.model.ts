import type {
  RobinhoodToolDefinition,
  ToolExecutionResult,
} from '@rh-agent-mcp/contracts';

export interface CallHistoryEntry {
  tool: string;
  args: Record<string, unknown>;
  result: ToolExecutionResult;
  timestamp: Date;
}

export interface AccountInfo {
  account_number: string;
  rhs_account_number?: string;
  nickname?: string;
  brokerage_account_type?: string;
  is_default?: boolean;
  agentic_allowed?: boolean;
  type?: string;
}

export interface ToolArgProperty {
  name: string;
  type: 'string' | 'string[]' | 'number' | 'boolean' | 'unknown';
  required: boolean;
  description?: string;
  isAccountNumber: boolean;
  useRhsAccountNumber: boolean;
  enumValues?: string[];
  format?: string;
}

export const TOOLS_USING_RHS_ACCOUNT_NUMBER = new Set<string>([
  'get_pnl_trade_history',
  'get_realized_pnl',
]);

export interface ToolInputSchema {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, ToolInputSchemaProperty>;
}

export interface ToolInputSchemaProperty {
  type?: string | string[];
  description?: string;
  items?: ToolInputSchemaProperty;
  required?: string[];
  enum?: string[];
  format?: string;
}

export const DEFAULT_ARRAY_DEFAULTS: Record<string, unknown[]> = {
  // Intentionally empty. Callers that want per-tool starter values can merge
  // overrides after `buildArgProperties` returns the default map.
};

export function isEmptyValue(value: unknown): boolean {
  return value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extracts a pagination cursor token from a URL, a bare query string, or a
 * plain token. Returns `undefined` when the input is empty or is a URL without
 * a `cursor` query parameter.
 */
function extractCursorToken(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    const cursor = url.searchParams.get('cursor');
    if (cursor?.trim()) {
      return cursor.trim();
    }
    // A pagination URL without a cursor is not a usable token.
    return undefined;
  } catch {
    // Not an absolute URL.
  }

  const match = trimmed.match(/[?&]cursor=([^&]+)/);
  if (match) {
    try {
      const decoded = decodeURIComponent(match[1]);
      if (decoded.trim()) {
        return decoded.trim();
      }
    } catch {
      if (match[1].trim()) {
        return match[1].trim();
      }
    }
    return undefined;
  }

  // If the value looks like a URL or query string but has no cursor parameter,
  // it is not a usable token. Otherwise treat it as a bare cursor token.
  if (trimmed.includes('?') || trimmed.includes('&')) {
    return undefined;
  }

  return trimmed;
}

function extractCursorFromContainer(container: unknown): string | undefined {
  if (!isPlainObject(container)) {
    return undefined;
  }

  const fromValue = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return undefined;
    }
    return extractCursorToken(value.trim());
  };

  return (
    fromValue(container['next']) ??
    fromValue(container['next_cursor']) ??
    fromValue(container['cursor'])
  );
}

export function extractNextCursor(result: unknown): string | undefined {
  if (!isPlainObject(result)) {
    return undefined;
  }

  return (
    extractCursorFromContainer(result) ??
    extractCursorFromContainer(result['data'])
  );
}

function isOptionInstrument(value: Record<string, unknown>): boolean {
  const type = value['type'] ?? value['option_type'];
  return (
    typeof value['chain_symbol'] === 'string' &&
    typeof value['expiration_date'] === 'string' &&
    typeof type === 'string' &&
    (typeof value['strike_price'] === 'string' || typeof value['strike_price'] === 'number')
  );
}

function buildOptionTicker(item: Record<string, unknown>): string {
  const symbol = String(item['chain_symbol']).toUpperCase();
  const expiration = item['expiration_date'];
  const typeRaw = String(item['type'] ?? item['option_type']);
  const type = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1).toLowerCase();
  const strikeNum = Number(item['strike_price']);
  const strike = Number.isFinite(strikeNum) ? strikeNum.toFixed(2) : String(item['strike_price']);
  return `${symbol} ${expiration} ${type} $${strike}`;
}

function buildOccSymbol(item: Record<string, unknown>): string {
  const symbol = String(item['chain_symbol']).toUpperCase();
  const [year, month, day] = String(item['expiration_date']).split('-');
  const typeRaw = String(item['type'] ?? item['option_type']).toUpperCase();
  const cp = typeRaw.startsWith('C') ? 'C' : 'P';
  const strikeNum = Math.round(Number(item['strike_price']) * 1000);
  const strike = String(strikeNum).padStart(8, '0');
  return `${symbol}${year.slice(-2)}${month}${day}${cp}${strike}`;
}

export function formatResultValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(formatResultValue);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const obj: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    obj[key] = formatResultValue(val);
  }
  if (isOptionInstrument(obj) && !('display_ticker' in obj)) {
    return {
      display_ticker: buildOptionTicker(obj),
      occ_symbol: buildOccSymbol(obj),
      ...obj,
    };
  }
  return obj;
}

export function parseExtraRedactFields(value: string): string[] {
  return value
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
}

export function formatArray(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return '';
}

export function parseArray(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export { maskAccountNumber } from '@rh-agent-mcp/utils';

export function selectDefaultAccount(accounts: AccountInfo[]): string {
  const agentic = accounts.find((a) => a.agentic_allowed);
  if (agentic) {
    return agentic.account_number;
  }
  const defaultAccount = accounts.find((a) => a.is_default);
  if (defaultAccount) {
    return defaultAccount.account_number;
  }
  return accounts[0]?.account_number ?? '';
}

export function inferPropertyType(prop: ToolInputSchemaProperty): ToolArgProperty['type'] {
  const type = prop.type;
  if (Array.isArray(type)) {
    if (type.includes('array') && prop.items?.type === 'string') {
      return 'string[]';
    }
    if (type.includes('string')) {
      return 'string';
    }
    if (type.includes('boolean')) {
      return 'boolean';
    }
    if (type.includes('number')) {
      return 'number';
    }
    if (type.includes('integer')) {
      return 'number';
    }
    return 'unknown';
  }

  if (type === 'array' && prop.items?.type === 'string') {
    return 'string[]';
  }
  if (type === 'string') {
    return 'string';
  }
  if (type === 'boolean') {
    return 'boolean';
  }
  if (type === 'number' || type === 'integer') {
    return 'number';
  }
  return 'unknown';
}

function extractEnumValues(prop: ToolInputSchemaProperty): string[] | undefined {
  if (!Array.isArray(prop.enum)) {
    return undefined;
  }
  const values = prop.enum.filter((v): v is string => typeof v === 'string');
  return values.length > 0 ? values : undefined;
}

export function inferDefaultValue(
  name: string,
  type: ToolArgProperty['type'],
  defaultAccountNumber: string,
  overrides: Record<string, unknown> = DEFAULT_ARRAY_DEFAULTS,
): unknown {
  if (name === 'account_number' && defaultAccountNumber) {
    return defaultAccountNumber;
  }
  const override = overrides[name];
  if (override !== undefined) {
    return override;
  }
  if (type === 'string[]') {
    return [];
  }
  if (type === 'boolean') {
    return false;
  }
  if (type === 'number') {
    return null;
  }
  return '';
}

function resolveDefaultAccountNumber(
  defaultAccountNumber: string,
  useRhsAccountNumber: boolean,
  accounts: AccountInfo[],
): string {
  if (!useRhsAccountNumber || !defaultAccountNumber) {
    return defaultAccountNumber;
  }
  const account = accounts.find((a) => a.account_number === defaultAccountNumber);
  return account?.rhs_account_number ?? defaultAccountNumber;
}

export function buildArgProperties(
  tool: RobinhoodToolDefinition,
  defaultAccountNumber: string,
  accounts: AccountInfo[] = [],
): { properties: ToolArgProperty[]; values: Record<string, unknown> } {
  const schema = tool.inputSchema as ToolInputSchema;
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  const properties = schema.properties ?? {};
  const propertiesArray = Object.entries(properties);
  const toolUsesRhsAccountNumber = TOOLS_USING_RHS_ACCOUNT_NUMBER.has(tool.name);

  const values: Record<string, unknown> = {};
  const argProps: ToolArgProperty[] = propertiesArray.map(([name, prop]) => {
    const type = inferPropertyType(prop);
    const isAccountNumber = name === 'account_number';
    const useRhsAccountNumber = isAccountNumber && toolUsesRhsAccountNumber;
    const propRequired = required.has(name);
    const resolvedAccountNumber = resolveDefaultAccountNumber(
      defaultAccountNumber,
      useRhsAccountNumber,
      accounts,
    );
    const value = inferDefaultValue(name, type, isAccountNumber ? resolvedAccountNumber : '');
    values[name] = value;

    return {
      name,
      type,
      required: propRequired,
      description: prop.description,
      isAccountNumber,
      useRhsAccountNumber,
      enumValues: extractEnumValues(prop),
      format: prop.format,
    };
  });

  return { properties: argProps, values };
}

const SYMBOL_FIELD_NAMES = new Set<string>([
  'symbol',
  'symbols',
  'chain_symbol',
  'underlying_symbol',
]);

export function isSymbolField(name: string): boolean {
  return SYMBOL_FIELD_NAMES.has(name);
}

export function normalizeSymbolValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.toUpperCase();
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.toUpperCase() : item));
  }
  return value;
}

export function cleanArgsForExecution(
  argProperties: ToolArgProperty[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const prop of argProperties) {
    const value = values[prop.name];
    if (isEmptyValue(value)) {
      continue;
    }
    cleaned[prop.name] = isSymbolField(prop.name)
      ? normalizeSymbolValue(value)
      : value;
  }
  return cleaned;
}

export function argsValid(argProperties: ToolArgProperty[], values: Record<string, unknown>): boolean {
  for (const prop of argProperties) {
    if (!prop.required) {
      continue;
    }
    if (isEmptyValue(values[prop.name])) {
      return false;
    }
  }
  return true;
}
