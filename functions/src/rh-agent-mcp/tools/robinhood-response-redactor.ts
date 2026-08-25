import { maskAccountNumber } from '@robinhood-mcp/utils';

/**
 * Redaction philosophy:
 *
 * - Redact only fields that are clearly PII or credentials (account numbers,
 *   names, government ids, contact info, etc.).
 * - Preserve public/reference identifiers such as option ids, chain ids,
 *   instrument ids, pagination URLs/cursors, and request uuids. These are not
 *   PII and are required for the dashboard to be useful.
 * - Users can mark additional fields for redaction via `extraFields` /
 *   `extraPatterns` in the dashboard UI.
 *
 * The safe-identifier allowlist exists so a future broad pattern cannot
 * accidentally start redacting non-PII reference ids again.
 */

const SAFE_IDENTIFIER_FIELDS = new Set<string>([
  'id',
  'uuid',
  'url',
  'cursor',
  'next',
  'previous',
  'href',
  'self',
  'chain_id',
  'option_id',
  'instrument_id',
  'order_id',
  'list_id',
  'scan_id',
  'watchlist_id',
  'ids',
  'chain_ids',
  'option_ids',
  'instrument_ids',
  'currency_pair_ids',
  'index_ids',
]);

const DEFAULT_SENSITIVE_FIELDS = new Set<string>([
  'account_number',
  'account_number_masked',
  'account_numbers',
  'account_id',
  'ssn',
  'tin',
  'social_security_number',
  'taxpayer_id',
  'first_name',
  'last_name',
  'full_name',
  'legal_name',
  'phone_number',
  'phone_numbers',
  'mobile_number',
  'email',
  'emails',
  'email_address',
  'address',
  'street_address',
  'city',
  'zip',
  'zip_code',
  'postal_code',
  'date_of_birth',
  'dob',
  'user_id',
  'customer_id',
  'client_id',
  'member_id',
  'profile_id',
]);

/**
 * Default regex patterns used to identify sensitive keys. Patterns ending with
 * `$` match field-name suffixes; patterns starting with `^` match exact field
 * names. Matching keys will be replaced by `redactValue`.
 */
const DEFAULT_SENSITIVE_PATTERNS = [
  /_account_number$/i,
  /_account_numbers$/i,
  /_account_id$/i, // e.g. brokerage_account_id
  /_ssn$/i, // e.g. last_4_ssn
  /_taxpayer_id$/i, // e.g. taxpayer_id_number
];

export interface RedactionOptions {
  extraFields?: string[];
  extraPatterns?: RegExp[];
  maskLength?: number;
}

function isSensitiveField(
  key: string,
  options: RedactionOptions,
): boolean {
  const normalized = key.toLowerCase();

  // Explicitly safe identifiers are never redacted, even if a future pattern
  // would otherwise match them.
  if (SAFE_IDENTIFIER_FIELDS.has(normalized)) {
    return false;
  }

  if (DEFAULT_SENSITIVE_FIELDS.has(normalized)) {
    return true;
  }
  if (options.extraFields?.some((field) => field.toLowerCase() === normalized)) {
    return true;
  }
  const patterns = [...DEFAULT_SENSITIVE_PATTERNS, ...(options.extraPatterns ?? [])];
  return patterns.some((pattern) => pattern.test(key));
}


function maskString(value: string): string {
  if (value.length <= 2) {
    return '•'.repeat(value.length);
  }
  return value[0] + '•'.repeat(value.length - 2) + value[value.length - 1];
}

function redactValue(
  key: string | undefined,
  value: unknown,
  options: RedactionOptions,
  forceSensitive = false,
): unknown {
  if (value === null || typeof value !== 'object') {
    if (!forceSensitive) {
      return value;
    }
    if (typeof value === 'string') {
      const lowerKey = key?.toLowerCase() ?? '';
      if (lowerKey.includes('account_number')) {
        return maskAccountNumber(value);
      }
      if (lowerKey.includes('name')) {
        return maskString(value);
      }
      return '••••';
    }
    if (typeof value === 'number') {
      return 0;
    }
    if (typeof value === 'boolean') {
      return false;
    }
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactValue(String(index), item, options, forceSensitive),
    );
  }

  const record = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(record)) {
    const childSensitive = forceSensitive || isSensitiveField(childKey, options);
    redacted[childKey] = redactValue(childKey, child, options, childSensitive);
  }
  return redacted;
}

export function redactResponse(
  response: unknown,
  options: RedactionOptions = {},
): unknown {
  return redactValue(undefined, response, options, false);
}
