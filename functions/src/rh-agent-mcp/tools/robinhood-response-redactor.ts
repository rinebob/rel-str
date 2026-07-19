import { maskAccountNumber } from '@rh-agent-mcp/utils';

const DEFAULT_SENSITIVE_FIELDS = new Set<string>([
  'account_number',
  'account_number_masked',
  'account_numbers',
  'ssn',
  'tin',
  'social_security_number',
  'taxpayer_id',
  'first_name',
  'last_name',
  'full_name',
  'legal_name',
  'phone_number',
  'email',
  'email_address',
  'address',
  'street_address',
  'city',
  'zip',
  'zip_code',
  'postal_code',
  'date_of_birth',
  'dob',
]);

/**
 * Default regex patterns used to identify sensitive keys. Patterns ending with
 * `$` match field-name suffixes; patterns starting with `^` match exact field
 * names. Matching keys will be replaced by `redactValue`.
 */
const DEFAULT_SENSITIVE_PATTERNS = [
  /_account_number$/,
  /_account_numbers$/,
  /_id$/, // e.g. trade_id, request_id (use carefully; may match non-identifier IDs)
  /_uuid$/, // e.g. request_uuid
  /_url$/, // e.g. callback_url
  /^id$/, // exact field name `id`
  /^uuid$/, // exact field name `uuid`
  /^url$/, // exact field name `url`
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
