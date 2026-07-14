/**
 * Shared helpers for the partner-symbol-added Pub/Sub consumer.
 *
 * Kept pure and Firebase-agnostic so they can be unit tested without
 * initializing cloud function handlers.
 */

import { RhAgentSymbolSource } from './rh-agent-collections';

export interface SymbolAddedPayloadV1 {
  version: 'v1';
  symbols: string[];
  createdAtUTC: string;
  status: 'ready';
  availableIntervals: string[];
  /** Optional source hint from the partner; normalized to a canonical enum value. */
  source?: string;
}

/**
 * Coerce an incoming source string into one of the canonical enum values.
 * Unknown/legacy/empty values fall back to MANUAL_ADD.
 */
export function normalizeSource(payloadSource: string | undefined): RhAgentSymbolSource {
  if (payloadSource === RhAgentSymbolSource.PARTNER_UNIVERSE) {
    return RhAgentSymbolSource.PARTNER_UNIVERSE;
  }
  if (payloadSource === RhAgentSymbolSource.MANUAL_ADD) {
    return RhAgentSymbolSource.MANUAL_ADD;
  }
  return RhAgentSymbolSource.MANUAL_ADD;
}

/**
 * Decode the base64 JSON payload carried by a Pub/Sub message and validate it.
 */
export function decodeSymbolAddedMessage(message: {
  data?: string;
  attributes?: Record<string, string>;
}): { body: SymbolAddedPayloadV1 | null; attributes: Record<string, string>; reason?: string } {
  if (!message.data) {
    throw new Error('Missing message data');
  }
  const jsonString = Buffer.from(message.data, 'base64').toString('utf8');
  const raw = JSON.parse(jsonString);
  const { body, reason } = validateSymbolAddedPayload(raw);
  return { body, reason, attributes: message.attributes || {} };
}

/**
 * Validate that the parsed payload matches the expected V1 shape.
 * Returns null for unsupported-but-ackable payloads (wrong version/status,
 * malformed symbols, etc.) so Pub/Sub does not retry them.
 */
export function validateSymbolAddedPayload(
  raw: unknown,
): { body: SymbolAddedPayloadV1 | null; reason?: string } {
  const body = raw as Partial<SymbolAddedPayloadV1>;
  if (body?.version !== 'v1') {
    return { body: null, reason: `unsupported version: ${body?.version}` };
  }
  if (body.status !== 'ready') {
    return { body: null, reason: `unsupported status: ${body.status}` };
  }
  if (!Array.isArray(body.symbols) || body.symbols.some((s) => typeof s !== 'string' || s.length === 0)) {
    return { body: null, reason: 'malformed symbols' };
  }
  if (typeof body.createdAtUTC !== 'string' || body.createdAtUTC.length === 0) {
    return { body: null, reason: 'missing or malformed createdAtUTC' };
  }
  if (!Array.isArray(body.availableIntervals)) {
    return { body: null, reason: 'malformed availableIntervals' };
  }
  return {
    body: {
      version: 'v1',
      symbols: body.symbols,
      createdAtUTC: body.createdAtUTC,
      status: 'ready',
      availableIntervals: body.availableIntervals,
      source: typeof body.source === 'string' ? body.source : undefined,
    },
  };
}
