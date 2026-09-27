/**
 * Tests for portfolio-allocation collection names and id builders
 * (Blueprint #581 / task #583).
 *
 * Approved formats:
 *   portfolio/buckets/items/{account}_{slug}        (bucket name slugified)
 *   portfolio/attributions/items/{account}_{instrumentId}
 *
 * Slug generation is intentionally lossy — distinct names may alias to the
 * same slug; creation is responsible for the existence check.
 */

import {
  PORTFOLIO_ATTRIBUTIONS_COLLECTION,
  PORTFOLIO_BUCKETS_COLLECTION,
  buildAttributionId,
  buildBucketId,
  bucketSlug,
} from './portfolio-allocation-ids';

const ACCT = '5AC12345';

describe('collection paths', () => {
  it('namespaces both kinds under the single `portfolio` root (anchor/items pattern)', () => {
    expect(PORTFOLIO_BUCKETS_COLLECTION).toBe('portfolio/buckets/items');
    expect(PORTFOLIO_ATTRIBUTIONS_COLLECTION).toBe('portfolio/attributions/items');
  });
});

describe('bucketSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(bucketSlug('CSP Wheel — Megacaps')).toBe('csp-wheel-megacaps');
    expect(bucketSlug('LEAP  Drops')).toBe('leap-drops');
  });

  it('strips characters outside [a-z0-9-] and collapses runs', () => {
    expect(bucketSlug('  CSP/Wheel: v2!  ')).toBe('csp-wheel-v2');
  });

  it('throws on names that slugify to empty', () => {
    expect(() => bucketSlug('!!!')).toThrow(/empty slug/);
    expect(() => bucketSlug('   ')).toThrow(/empty slug/);
  });

  it('aliases distinct spellings to one slug — creation must de-dupe', () => {
    // Documented contract: case-fold + punctuation-fold is intentional and
    // lossy; the id builder never disambiguates.
    expect(bucketSlug('CSP Wheel')).toBe(bucketSlug('csp-wheel'));
    expect(bucketSlug('CSP:Wheel')).toBe(bucketSlug('CSP  Wheel'));
  });

  it('treats non-ASCII letters as separators — pure non-ASCII throws', () => {
    expect(bucketSlug('Café A')).toBe('caf-a');
    expect(() => bucketSlug('αβγ')).toThrow(/empty slug/);
  });
});

describe('buildBucketId', () => {
  it('composes {accountNumber}_{slug}', () => {
    expect(buildBucketId(ACCT, 'CSP Wheel')).toBe('5AC12345_csp-wheel');
  });

  it('rejects account numbers outside [A-Za-z0-9] (keeps _ unambiguous)', () => {
    expect(() => buildBucketId('5AC_12345', 'CSP Wheel')).toThrow(/invalid account number/);
    expect(() => buildBucketId('', 'CSP Wheel')).toThrow(/invalid account number/);
  });
});

describe('buildAttributionId', () => {
  it('composes {accountNumber}_{instrumentId}', () => {
    expect(buildAttributionId(ACCT, 'abc-inst-1')).toBe('5AC12345_abc-inst-1');
  });

  it('rejects empty or slash-containing instrument ids', () => {
    expect(() => buildAttributionId(ACCT, '')).toThrow(/invalid instrument id/);
    expect(() => buildAttributionId(ACCT, 'a/b')).toThrow(/invalid instrument id/);
  });

  it('rejects invalid account numbers', () => {
    expect(() => buildAttributionId('acct_1', 'inst-1')).toThrow(/invalid account number/);
  });
});
