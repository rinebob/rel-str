/**
 * @topic #984 — ST Firestore Reorg (task #998)
 *
 * Pins the canonical StStrategyInstance shape (st-strategy-instances/{id}) —
 * StrategyInstanceConfig extended with mode/enabled/lastFiredAt — consumed
 * via `@st/strategy-instances`.
 */
import { StStrategyInstance } from './st-strategy-instances';
import { TradeSide } from './common';
import { LifecycleState } from './options-strategy-engine-contracts';
import {
  OptionType,
  PositionSpreadType,
  StrategyFrequency,
} from './options-common';

const INSTANCE: StStrategyInstance = {
  id: 'inst-1',
  symbol: 'ADPT',
  optionType: OptionType.PUT,
  side: TradeSide.SHORT,
  phases: [{ spreadType: PositionSpreadType.CASH_SECURED_PUT, targetDelta: 0.3, dteMin: 30, dteMax: 60 }],
  frequency: StrategyFrequency.DAILY,
  openTimePT: '13:00',
  exitPolicies: [],
  lifecycleState: LifecycleState.ACTIVE,
  userId: 'u1',
  createdAt: '2026-10-14T21:00:00Z',
  updatedAt: '2026-10-14T21:00:00Z',
  // StStrategyInstance additions
  mode: 'paper',
  paperAccountId: 'acct-paper-u1',
  enabled: true,
  lastFiredAt: '2026-10-14T21:00:00Z',
};

describe('StStrategyInstance', () => {
  it('extends StrategyInstanceConfig with mode/enabled/lastFiredAt', () => {
    expect(INSTANCE.mode).toBe('paper');
    expect(INSTANCE.paperAccountId).toBe('acct-paper-u1');
    expect(INSTANCE.enabled).toBe(true);
    expect(INSTANCE.lastFiredAt).toBe('2026-10-14T21:00:00Z');
    // inherited engine fields still present
    expect(INSTANCE.symbol).toBe('ADPT');
    expect(INSTANCE.phases).toHaveLength(1);
    expect(INSTANCE.lifecycleState).toBe(LifecycleState.ACTIVE);
  });

  it('serializes to JSON and round-trips intact', () => {
    expect(JSON.parse(JSON.stringify(INSTANCE))).toEqual(INSTANCE);
  });
});
