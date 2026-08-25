import {
  decodeSymbolAddedMessage,
  normalizeSource,
  validateSymbolAddedPayload,
  type SymbolAddedPayloadV1,
} from '../../functions/src/common/st-symbol-added-helpers';
import { StSymbolSource } from '../../functions/src/common/st-collections';

describe('normalizeSource', () => {
  it('returns PARTNER_UNIVERSE for the canonical partner value', () => {
    expect(normalizeSource(StSymbolSource.PARTNER_UNIVERSE)).toBe(
      StSymbolSource.PARTNER_UNIVERSE,
    );
  });

  it('returns MANUAL_ADD for the canonical manual value', () => {
    expect(normalizeSource(StSymbolSource.MANUAL_ADD)).toBe(
      StSymbolSource.MANUAL_ADD,
    );
  });

  it('falls back to MANUAL_ADD for undefined', () => {
    expect(normalizeSource(undefined)).toBe(StSymbolSource.MANUAL_ADD);
  });

  it('falls back to MANUAL_ADD for legacy or arbitrary values', () => {
    expect(normalizeSource('partner-universe-260713')).toBe(
      StSymbolSource.MANUAL_ADD,
    );
    expect(normalizeSource('manual-add-backfill_26-0713')).toBe(
      StSymbolSource.MANUAL_ADD,
    );
    expect(normalizeSource('something-else')).toBe(StSymbolSource.MANUAL_ADD);
  });
});

describe('validateSymbolAddedPayload', () => {
  const validPayload: import('../../functions/src/common/st-symbol-added-helpers').SymbolAddedPayloadV1 = {
    version: 'v1',
    symbols: ['AAPL', 'TSLA'],
    addedAtUTC: '2026-07-13T20:00:00Z',
    status: 'ready',
    availableIntervals: ['DAILY'],
    source: StSymbolSource.MANUAL_ADD,
  };

  it('returns a normalized body for a valid payload', () => {
    const { body, reason } = validateSymbolAddedPayload(validPayload);
    expect(reason).toBeUndefined();
    expect(body).toEqual(validPayload);
  });

  it('rejects an unsupported version', () => {
    const { body, reason } = validateSymbolAddedPayload({ ...validPayload, version: 'v2' });
    expect(body).toBeNull();
    expect(reason).toContain('unsupported version');
  });

  it('rejects a non-ready status', () => {
    const { body, reason } = validateSymbolAddedPayload({ ...validPayload, status: 'pending' });
    expect(body).toBeNull();
    expect(reason).toContain('unsupported status');
  });

  it('rejects malformed symbols', () => {
    const { body, reason } = validateSymbolAddedPayload({
      ...validPayload,
      symbols: ['', 123 as unknown as string],
    });
    expect(body).toBeNull();
    expect(reason).toContain('malformed symbols');
  });

  it('rejects missing addedAtUTC', () => {
    const { body, reason } = validateSymbolAddedPayload({
      ...validPayload,
      addedAtUTC: '',
    });
    expect(body).toBeNull();
    expect(reason).toContain('addedAtUTC');
  });

  it('allows optional source to be omitted', () => {
    const { body } = validateSymbolAddedPayload({ ...validPayload, source: undefined });
    expect(body?.source).toBeUndefined();
  });
});

describe('decodeSymbolAddedMessage', () => {
  const validPayload: SymbolAddedPayloadV1 = {
    version: 'v1',
    symbols: ['AAPL'],
    addedAtUTC: '2026-07-13T20:00:00Z',
    status: 'ready',
    availableIntervals: ['DAILY'],
  };

  it('decodes a base64 payload and validates it', () => {
    const data = Buffer.from(JSON.stringify(validPayload)).toString('base64');
    const { body, reason } = decodeSymbolAddedMessage({ data, attributes: { key: 'value' } });
    expect(body).toEqual({ ...validPayload, source: undefined });
    expect(reason).toBeUndefined();
  });

  it('throws when message data is missing', () => {
    expect(() => decodeSymbolAddedMessage({ attributes: {} })).toThrow('Missing message data');
  });
});
