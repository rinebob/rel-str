/**
 * Trading Case helpers — lifecycle derivation, decimal-safe quantity helpers,
 * order terms validation, path helpers, and readable ID builder.
 *
 * Decimal precision policy: equity/ETF quantities are stored as decimal strings
 * and normalized to at most 6 decimal places. Numeric helpers use integer
 * arithmetic on scaled values (multiply by 1e6, subtract, divide back) to
 * avoid floating-point rounding. Invalid inputs throw rather than silently
 * coercing to zero.
 *
 * Framework-free so frontend and functions backend can share the domain seam.
 */

import type { EquityOrderTerms } from './types.ts';
import {
  BrokerOrderLifecycleState,
  BrokerOrderRole,
  TRADING_CASES_COLLECTION,
} from './types.ts';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function brokerOrdersCollectionPath(caseId: string): string {
  return `${TRADING_CASES_COLLECTION}/${caseId}/broker-orders`;
}

export function brokerOrderDocumentPath(caseId: string, humanReadableDocumentId: string): string {
  return `${brokerOrdersCollectionPath(caseId)}/${humanReadableDocumentId}`;
}

// ---------------------------------------------------------------------------
// Lifecycle derivation
// ---------------------------------------------------------------------------

/**
 * Derive a broker order lifecycle state from a raw Robinhood state string.
 *
 * `confirmed` maps to `RESTING` only when `verifiedResting` is true. The caller
 * (BE adapter) is responsible for determining this based on order type and
 * trigger/price evidence — typically `verifiedResting = true` for GTC limit,
 * stop-market, and stop-limit orders that are confirmed and resting.
 *
 * `filled`, `rejected`, and `failed` are mapped directly to terminal states.
 * The BE adapter is responsible for pre-verifying fill evidence (executions,
 * cumulative quantity) and error semantics before calling this function.
 * If the adapter cannot verify, it should pass the raw state through and
 * the caller may override the derived state to `UNCLASSIFIED`.
 *
 * Unknown/unverified raw states map to `UNCLASSIFIED` rather than being guessed
 * into a semantic state. The raw state is always preserved on the record.
 */
export function deriveBrokerOrderState(
  rawState: string,
  options: { verifiedResting?: boolean } = {},
): BrokerOrderLifecycleState {
  switch (rawState.trim().toLowerCase()) {
    case 'queued': return BrokerOrderLifecycleState.QUEUED;
    case 'partially_filled': return BrokerOrderLifecycleState.PARTIALLY_FILLED;
    case 'filled': return BrokerOrderLifecycleState.FILLED;
    case 'cancelled': return BrokerOrderLifecycleState.CANCELLED;
    case 'canceled': return BrokerOrderLifecycleState.CANCELLED; // compatibility spelling — PRD allows alias
    case 'expired': return BrokerOrderLifecycleState.EXPIRED;
    case 'rejected': return BrokerOrderLifecycleState.REJECTED;
    case 'failed': return BrokerOrderLifecycleState.FAILED;
    case 'confirmed': return options.verifiedResting
      ? BrokerOrderLifecycleState.RESTING
      : BrokerOrderLifecycleState.SUBMITTED;
    case 'new':
    case 'unconfirmed':
    case 'voided':
    default: return BrokerOrderLifecycleState.UNCLASSIFIED;
  }
}

export function isTerminalBrokerOrderState(state: BrokerOrderLifecycleState): boolean {
  return state === BrokerOrderLifecycleState.FILLED ||
    state === BrokerOrderLifecycleState.CANCELLED ||
    state === BrokerOrderLifecycleState.EXPIRED ||
    state === BrokerOrderLifecycleState.REJECTED ||
    state === BrokerOrderLifecycleState.FAILED;
}

// ---------------------------------------------------------------------------
// Decimal-safe quantity helpers
// ---------------------------------------------------------------------------

const DECIMAL_PRECISION = 6;

/**
 * Parse a decimal string into a scaled integer (value * 1e6).
 * Throws on invalid input rather than silently coercing to zero.
 */
function parseScaledDecimal(value: string): number {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid decimal string: "${value}"`);
  }
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal string: "${value}"`);
  }
  const negative = trimmed.startsWith('-');
  const [intPart, fracPart = ''] = trimmed.replace(/^-/, '').split('.');
  if (fracPart.length > DECIMAL_PRECISION) {
    throw new Error(`Decimal string exceeds ${DECIMAL_PRECISION} decimal places: "${value}"`);
  }
  const paddedFrac = fracPart.padEnd(DECIMAL_PRECISION, '0');
  const scaled = parseInt(intPart + paddedFrac, 10);
  if (!Number.isSafeInteger(scaled)) {
    throw new Error(`Decimal string value too large for safe integer arithmetic: "${value}"`);
  }
  return negative ? -scaled : scaled;
}

/**
 * Format a scaled integer back to a decimal string with at most 6 decimal places.
 * Trailing zeros are stripped.
 */
function formatScaledDecimal(scaled: number): string {
  const negative = scaled < 0;
  const abs = Math.abs(scaled);
  const str = abs.toString().padStart(DECIMAL_PRECISION + 1, '0');
  const intPart = str.slice(0, str.length - DECIMAL_PRECISION) || '0';
  let fracPart = str.slice(str.length - DECIMAL_PRECISION).replace(/0+$/, '');
  let result = fracPart ? `${intPart}.${fracPart}` : intPart;
  if (negative && abs > 0) result = `-${result}`;
  return result || '0';
}

/**
 * Calculate remaining quantity from requested and cumulative quantities.
 * Uses integer arithmetic on scaled values to avoid floating-point rounding.
 * Clamped to 0 — never reports negative remaining.
 * Throws on invalid input.
 */
export function remainingQuantity(requested: string, cumulative: string): string {
  const requestedScaled = parseScaledDecimal(requested);
  const cumulativeScaled = parseScaledDecimal(cumulative);
  const remaining = Math.max(0, requestedScaled - cumulativeScaled);
  return formatScaledDecimal(remaining);
}

/**
 * Derive aggregate protection state for a long position.
 * `protected` = protected amount covers the full position.
 * `drifted` = partial protection (protected amount > 0 but < position).
 * `unprotected` = no protection, zero position, or short position.
 * Throws on invalid input.
 */
export function getProtectionState(
  positionQuantity: string,
  protectedQuantity: string,
): 'protected' | 'drifted' | 'unprotected' {
  const position = parseScaledDecimal(positionQuantity);
  const protectedAmount = parseScaledDecimal(protectedQuantity);
  if (protectedAmount <= 0 || position <= 0) return 'unprotected';
  return protectedAmount >= position ? 'protected' : 'drifted';
}

// ---------------------------------------------------------------------------
// Order terms validation
// ---------------------------------------------------------------------------

const DECIMAL_PATTERN = /^\d+(\.\d{1,6})?$/;

/**
 * Validate that EquityOrderTerms has the required fields for its order type,
 * does not carry incoherent extra fields, and that all numeric fields are
 * well-formed non-negative decimal strings with at most 6 decimal places.
 * Returns an error message string if invalid, null if valid.
 */
export function validateEquityOrderTerms(terms: EquityOrderTerms): string | null {
  if (!terms.quantity && !terms.dollarAmount) {
    return 'Either quantity or dollarAmount must be present';
  }
  if (terms.quantity && terms.dollarAmount) {
    return 'Only one of quantity or dollarAmount may be present';
  }
  if (terms.quantity && !DECIMAL_PATTERN.test(terms.quantity)) {
    return 'quantity must be a non-negative decimal with at most 6 decimal places';
  }
  if (terms.dollarAmount && !DECIMAL_PATTERN.test(terms.dollarAmount)) {
    return 'dollarAmount must be a non-negative decimal with at most 6 decimal places';
  }
  if (terms.limitPrice && !DECIMAL_PATTERN.test(terms.limitPrice)) {
    return 'limitPrice must be a non-negative decimal with at most 6 decimal places';
  }
  if (terms.stopPrice && !DECIMAL_PATTERN.test(terms.stopPrice)) {
    return 'stopPrice must be a non-negative decimal with at most 6 decimal places';
  }
  switch (terms.orderType) {
    case 'market':
      if (terms.limitPrice) return 'market order must not have limitPrice';
      if (terms.stopPrice) return 'market order must not have stopPrice';
      break;
    case 'limit':
      if (!terms.limitPrice) return 'limit order requires limitPrice';
      if (terms.stopPrice) return 'limit order must not have stopPrice';
      break;
    case 'stop_market':
      if (!terms.stopPrice) return 'stop_market order requires stopPrice';
      if (terms.limitPrice) return 'stop_market order must not have limitPrice';
      break;
    case 'stop_limit':
      if (!terms.limitPrice) return 'stop_limit order requires limitPrice';
      if (!terms.stopPrice) return 'stop_limit order requires stopPrice';
      break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Readable ID builder
// ---------------------------------------------------------------------------

const FIRESTORE_SAFE = /^[A-Z0-9_.-]+$/;

/**
 * Build a human-readable Firestore document ID for a broker order.
 *
 * Symbol is uppercased and validated for Firestore-safe characters.
 * Callers MUST ensure sequence uniqueness — two orders for the same symbol/role
 * in the same minute will collide unless `sequence` is incremented. Use a
 * repository-backed counter or pass `entropySuffix` (e.g. a short hash of
 * brokerOrderId) when the external ID is known.
 */
export function buildReadableBrokerOrderId(
  symbol: string,
  role: BrokerOrderRole,
  now: Date,
  sequence = 1,
  entropySuffix?: string,
): string {
  if (sequence < 1 || sequence > 99) {
    throw new Error(`sequence must be between 1 and 99, got: ${sequence}`);
  }
  const upperSymbol = symbol.toUpperCase();
  if (!FIRESTORE_SAFE.test(upperSymbol)) {
    throw new Error(`Symbol contains unsafe characters for Firestore path: "${symbol}"`);
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now).reduce<Record<string, string>>((values, part) => {
    values[part.type] = part.value;
    return values;
  }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const seqSuffix = sequence > 1 ? `-${String(sequence).padStart(2, '0')}` : '';
  let entropy = '';
  if (entropySuffix) {
    const sanitized = entropySuffix.replace(/[^A-Za-z0-9_.-]/g, '').toUpperCase().slice(0, 16);
    if (!sanitized) {
      throw new Error(`entropySuffix contains no safe characters: "${entropySuffix}"`);
    }
    entropy = `-${sanitized}`;
  }
  return `${upperSymbol}-${role.toUpperCase()}-${parts.year}${parts.month}${parts.day}-${parts.weekday.toUpperCase()}-${hour}${parts.minute}PT${seqSuffix}${entropy}`;
}
