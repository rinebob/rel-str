/**
 * Unit tests for shared/options-common.ts and shared/spread-contracts.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OptionType,
  parseOccContractId,
  buildOccContractId,
} from '../../shared/options-common.ts';

import {
  SpreadType,
  DebitOrCredit,
  SpreadStatus,
  SpreadRunStatus,
  SpreadJobStatus,
} from '../../shared/spread-contracts.ts';

// ── OptionType enum ────────────────────────────

describe('OptionType enum', () => {
  it('CALL === "call"', () => {
    assert.equal(OptionType.CALL, 'call');
  });

  it('PUT === "put"', () => {
    assert.equal(OptionType.PUT, 'put');
  });
});

// ── parseOccContractId ─────────────────────────

describe('parseOccContractId', () => {
  it('parses a valid call contract ID', () => {
    const result = parseOccContractId('QQQ240719C00450000');
    assert.notEqual(result, null);
    assert.equal(result!.symbol, 'QQQ');
    assert.equal(result!.expiration, '2024-07-19');
    assert.equal(result!.optionType, OptionType.CALL);
    assert.equal(result!.strike, 450);
    assert.equal(result!.contractID, 'QQQ240719C00450000');
  });

  it('parses a valid put contract ID', () => {
    const result = parseOccContractId('SPY240119P00400000');
    assert.notEqual(result, null);
    assert.equal(result!.symbol, 'SPY');
    assert.equal(result!.expiration, '2024-01-19');
    assert.equal(result!.optionType, OptionType.PUT);
    assert.equal(result!.strike, 400);
  });

  it('parses lowercase input (normalizes to upper)', () => {
    const result = parseOccContractId('qqq240719c00450000');
    assert.notEqual(result, null);
    assert.equal(result!.symbol, 'QQQ');
    assert.equal(result!.optionType, OptionType.CALL);
  });

  it('returns null for empty string', () => {
    assert.equal(parseOccContractId(''), null);
  });

  it('returns null for whitespace-only string', () => {
    assert.equal(parseOccContractId('   '), null);
  });

  it('returns null for null/undefined input', () => {
    assert.equal(parseOccContractId(null as unknown as string), null);
    assert.equal(parseOccContractId(undefined as unknown as string), null);
  });

  it('returns null for malformed ID (missing strike)', () => {
    assert.equal(parseOccContractId('QQQ240719C'), null);
  });

  it('returns null for malformed ID (wrong type char)', () => {
    assert.equal(parseOccContractId('QQQ240719X00450000'), null);
  });

  it('returns null for malformed ID (non-numeric strike)', () => {
    assert.equal(parseOccContractId('QQQ240719C00AB0000'), null);
  });

  it('handles strike with decimal precision', () => {
    const result = parseOccContractId('QQQ240719C00450500');
    assert.notEqual(result, null);
    assert.equal(result!.strike, 450.5);
  });
});

// ── buildOccContractId ─────────────────────────

describe('buildOccContractId', () => {
  it('builds a correct call contract ID', () => {
    const id = buildOccContractId('QQQ', '2024-07-19', OptionType.CALL, 450);
    assert.equal(id, 'QQQ240719C00450000');
  });

  it('builds a correct put contract ID', () => {
    const id = buildOccContractId('SPY', '2024-01-19', OptionType.PUT, 400);
    assert.equal(id, 'SPY240119P00400000');
  });

  it('normalizes symbol to uppercase', () => {
    const id = buildOccContractId('qqq', '2024-07-19', OptionType.CALL, 450);
    assert.equal(id, 'QQQ240719C00450000');
  });

  it('handles decimal strikes', () => {
    const id = buildOccContractId('SPY', '2024-01-19', OptionType.PUT, 400.5);
    assert.equal(id, 'SPY240119P00400500');
  });

  it('pads strike to 8 digits', () => {
    const id = buildOccContractId('SPY', '2024-01-19', OptionType.PUT, 5);
    assert.equal(id, 'SPY240119P00005000');
  });

  it('throws on empty symbol', () => {
    assert.throws(() => buildOccContractId('  ', '2024-01-19', OptionType.PUT, 400), /symbol/);
  });

  it('throws on malformed expiration (missing dashes)', () => {
    assert.throws(() => buildOccContractId('SPY', '20240119', OptionType.PUT, 400), /YYYY-MM-DD/);
  });

  it('throws on malformed expiration (wrong separator)', () => {
    assert.throws(() => buildOccContractId('SPY', '2024/01/19', OptionType.PUT, 400), /YYYY-MM-DD/);
  });

  it('throws on negative strike', () => {
    assert.throws(() => buildOccContractId('SPY', '2024-01-19', OptionType.PUT, -1), /non-negative/);
  });
});

// ── Round-trip: build → parse ──────────────────

describe('buildOccContractId → parseOccContractId round-trip', () => {
  it('preserves all fields for a call', () => {
    const symbol = 'QQQ';
    const expiration = '2024-07-19';
    const optionType = OptionType.CALL;
    const strike = 450;
    const id = buildOccContractId(symbol, expiration, optionType, strike);
    const parsed = parseOccContractId(id);
    assert.notEqual(parsed, null);
    assert.equal(parsed!.symbol, symbol);
    assert.equal(parsed!.expiration, expiration);
    assert.equal(parsed!.optionType, optionType);
    assert.equal(parsed!.strike, strike);
  });

  it('preserves all fields for a put with decimal strike', () => {
    const symbol = 'SPY';
    const expiration = '2024-01-19';
    const optionType = OptionType.PUT;
    const strike = 400.5;
    const id = buildOccContractId(symbol, expiration, optionType, strike);
    const parsed = parseOccContractId(id);
    assert.notEqual(parsed, null);
    assert.equal(parsed!.symbol, symbol);
    assert.equal(parsed!.expiration, expiration);
    assert.equal(parsed!.optionType, optionType);
    assert.equal(parsed!.strike, strike);
  });
});

// ── Spread enum value tests ────────────────────

describe('SpreadType enum', () => {
  it('VERTICAL === "vertical"', () => {
    assert.equal(SpreadType.VERTICAL, 'vertical');
  });
  it('STRADDLE === "straddle"', () => {
    assert.equal(SpreadType.STRADDLE, 'straddle');
  });
  it('STRANGLE === "strangle"', () => {
    assert.equal(SpreadType.STRANGLE, 'strangle');
  });
  it('IRON_CONDOR === "iron_condor"', () => {
    assert.equal(SpreadType.IRON_CONDOR, 'iron_condor');
  });
  it('CUSTOM === "custom"', () => {
    assert.equal(SpreadType.CUSTOM, 'custom');
  });
});

describe('DebitOrCredit enum', () => {
  it('DEBIT === "debit"', () => {
    assert.equal(DebitOrCredit.DEBIT, 'debit');
  });
  it('CREDIT === "credit"', () => {
    assert.equal(DebitOrCredit.CREDIT, 'credit');
  });
});

describe('SpreadStatus enum', () => {
  it('PENDING === "pending"', () => {
    assert.equal(SpreadStatus.PENDING, 'pending');
  });
  it('LOADING === "loading"', () => {
    assert.equal(SpreadStatus.LOADING, 'loading');
  });
  it('LOADED === "loaded"', () => {
    assert.equal(SpreadStatus.LOADED, 'loaded');
  });
  it('ERROR === "error"', () => {
    assert.equal(SpreadStatus.ERROR, 'error');
  });
});

describe('SpreadRunStatus enum', () => {
  it('IN_PROGRESS === "IN_PROGRESS"', () => {
    assert.equal(SpreadRunStatus.IN_PROGRESS, 'IN_PROGRESS');
  });
  it('COMPLETE === "COMPLETE"', () => {
    assert.equal(SpreadRunStatus.COMPLETE, 'COMPLETE');
  });
  it('PARTIAL === "PARTIAL"', () => {
    assert.equal(SpreadRunStatus.PARTIAL, 'PARTIAL');
  });
  it('FAILED === "FAILED"', () => {
    assert.equal(SpreadRunStatus.FAILED, 'FAILED');
  });
});

describe('SpreadJobStatus enum', () => {
  it('PENDING === "PENDING"', () => {
    assert.equal(SpreadJobStatus.PENDING, 'PENDING');
  });
  it('IN_PROGRESS === "IN_PROGRESS"', () => {
    assert.equal(SpreadJobStatus.IN_PROGRESS, 'IN_PROGRESS');
  });
  it('SUCCESS === "SUCCESS"', () => {
    assert.equal(SpreadJobStatus.SUCCESS, 'SUCCESS');
  });
  it('TRANSIENT_FAILURE === "TRANSIENT_FAILURE"', () => {
    assert.equal(SpreadJobStatus.TRANSIENT_FAILURE, 'TRANSIENT_FAILURE');
  });
  it('PERMANENT_FAILURE === "PERMANENT_FAILURE"', () => {
    assert.equal(SpreadJobStatus.PERMANENT_FAILURE, 'PERMANENT_FAILURE');
  });
});
