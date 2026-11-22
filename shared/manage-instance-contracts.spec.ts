/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1538 — SHARED: Manage instance + variant contracts (run-state, stop-type)
 *
 * Fixture-shape + invariant tests for the manage-domain instance contracts:
 * run-state vocabulary (UNSTARTED/ACTIVE/STOPPED), mode/trigger vocabularies,
 * the paper⇒'ALL' / real⇒concrete stop-type invariant, and the embedded
 * variant snapshot on the instance doc.
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import type { ManageVariant } from './manage-variant-contracts';
import {
  INSTANCE_MODES,
  INSTANCE_RUN_STATES,
  INSTANCE_TRIGGERS,
  isValidModeStopType,
  ManageInstance,
  MANAGE_ADHOC_VARIANT_REF,
  STOP_TYPE_ALL,
} from './manage-instance-contracts';

const VARIANT: ManageVariant = {
  id: 'cds-30-50-40',
  name: 'call debit spread 30 50-40',
  templateId: 'cds',
  dte: 30,
  legs: [
    { kind: 'option', type: OptionType.CALL, targetDelta: 0.5, dte: 30, side: TradeSide.LONG },
    { kind: 'option', type: OptionType.CALL, targetDelta: 0.4, dte: 30, side: TradeSide.SHORT },
  ],
};

describe('manage-instance-contracts', () => {
  describe('vocabulary consts', () => {
    it('run states are UNSTARTED | ACTIVE | STOPPED — no PAUSED in the manage model', () => {
      expect(INSTANCE_RUN_STATES).toEqual(['UNSTARTED', 'ACTIVE', 'STOPPED']);
    });

    it('modes are paper | real — explicit PRD vocabulary, not the legacy live/paper split', () => {
      expect(INSTANCE_MODES).toEqual(['paper', 'real']);
    });

    it('triggers are daily | signal', () => {
      expect(INSTANCE_TRIGGERS).toEqual(['daily', 'signal']);
    });
  });

  describe('isValidModeStopType (paper⇒ALL / real⇒concrete invariant)', () => {
    it('paper requires stopType ALL', () => {
      expect(isValidModeStopType('paper', STOP_TYPE_ALL)).toBe(true);
      expect(isValidModeStopType('paper', 'T8')).toBe(false);
    });

    it('real requires a concrete non-ALL stop code', () => {
      expect(isValidModeStopType('real', 'T8')).toBe(true);
      expect(isValidModeStopType('real', STOP_TYPE_ALL)).toBe(false);
      expect(isValidModeStopType('real', '')).toBe(false);
      expect(isValidModeStopType('real', '   ')).toBe(false);
    });

    it('case/padding variants of ALL are rejected for real — they normalize into the reserved segment', () => {
      // The ID bakes the stop code as ALL-CAPS — 'all' would collide with
      // paper's 'ALL' segment after normalization.
      expect(isValidModeStopType('real', 'all')).toBe(false);
      expect(isValidModeStopType('real', ' ALL ')).toBe(false);
      expect(isValidModeStopType('real', 'All')).toBe(false);
    });

    it('paper accepts ALL case/padding variants — they normalize to the same code', () => {
      expect(isValidModeStopType('paper', ' all ')).toBe(true);
    });
  });

  describe('ManageInstance', () => {
    it('embeds the resolved variant snapshot — self-describing even for ad hoc variants', () => {
      const instance: ManageInstance = {
        id: 'QQQ-CDS-30-50-40-ALL',
        variantRef: MANAGE_ADHOC_VARIANT_REF,
        variant: VARIANT,
        symbol: 'QQQ',
        mode: 'paper',
        trigger: 'daily',
        stopType: STOP_TYPE_ALL,
        runState: 'UNSTARTED',
        userId: 'u1',
        paperAccountId: 'pa-1',
        createdAt: '2026-11-14T20:00:00Z',
        updatedAt: '2026-11-14T20:00:00Z',
      };
      expect(instance.variant.name).toBe('call debit spread 30 50-40');
      expect(instance.runState).toBe('UNSTARTED');
    });

    it('id is {SYM}-{SPREAD}-{DTE}-{ΔLEGS}-{STOP} — variant+symbol+stop unique by construction', () => {
      const real: ManageInstance = {
        id: 'QQQ-CDS-30-50-40-T8',
        variantRef: 'cds-30-50-40',
        variant: VARIANT,
        symbol: 'QQQ',
        mode: 'real',
        trigger: 'signal',
        stopType: 'T8',
        runState: 'ACTIVE',
        userId: 'u1',
        createdAt: '2026-11-14T20:00:00Z',
        updatedAt: '2026-11-14T20:05:00Z',
        lastFiredAt: '2026-11-14T20:05:00Z',
      };
      expect(real.id.endsWith(real.stopType)).toBe(true);
      expect(real.paperAccountId).toBeUndefined();
    });
  });
});
