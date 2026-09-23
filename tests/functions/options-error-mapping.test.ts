/**
 * Unit tests for partner error → callable code mapping (task #519).
 *
 * SA's corpus rollout adds a distinguishable "symbol not enabled for
 * options" signal — a body `code` field alongside the HTTP status. The
 * callable maps it to a dedicated callable code so the FE can render a
 * specific message instead of a generic fetch failure.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PartnerHttpError,
  extractPartnerCode,
  partnerHttpErrorToCallableCode,
} from '../../functions/src/partner-infrastructure.ts';

describe('extractPartnerCode', () => {
  it('returns the code field from a JSON error body', () => {
    const text = JSON.stringify({ ok: false, code: 'OPTIONS_NOT_ENABLED', message: 'nope' });
    assert.equal(extractPartnerCode(text), 'OPTIONS_NOT_ENABLED');
  });

  it('returns undefined when the body has no code', () => {
    assert.equal(extractPartnerCode(JSON.stringify({ ok: false })), undefined);
    assert.equal(extractPartnerCode('not json at all'), undefined);
    assert.equal(extractPartnerCode(''), undefined);
  });

  it('returns undefined for a non-string code', () => {
    assert.equal(extractPartnerCode(JSON.stringify({ code: 42 })), undefined);
  });
});

describe('partnerHttpErrorToCallableCode', () => {
  it('maps OPTIONS_NOT_ENABLED to failed-precondition', () => {
    const err = new PartnerHttpError('upstream 404', 404, 'OPTIONS_NOT_ENABLED');
    assert.equal(partnerHttpErrorToCallableCode(err), 'failed-precondition');
  });

  it('leaves plain 404 (no code) as not-found', () => {
    const err = new PartnerHttpError('upstream 404', 404);
    assert.equal(partnerHttpErrorToCallableCode(err), 'not-found');
  });

  it('existing status mappings are unchanged', () => {
    assert.equal(partnerHttpErrorToCallableCode(new PartnerHttpError('x', 429)), 'resource-exhausted');
    assert.equal(partnerHttpErrorToCallableCode(new PartnerHttpError('x', 502)), 'unavailable');
    assert.equal(partnerHttpErrorToCallableCode(new PartnerHttpError('x', 504)), 'unavailable');
    assert.equal(partnerHttpErrorToCallableCode(new PartnerHttpError('x', 400)), 'invalid-argument');
  });
});
