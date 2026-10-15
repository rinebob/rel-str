/**
 * @topic #984 — ST Firestore Reorg (task #998)
 *
 * Pins the canonical StPositionGroup shape
 * (st-position-groups/{SYM}-{YYMMDD}-grp-{NN}) consumed via `@st/position-groups`.
 */
import {
  ST_GROUP_ORIGIN_TYPES,
  ST_POSITION_GROUP_STATUSES,
  StPositionGroup,
} from './st-position-groups';
const GROUP: StPositionGroup = {
  id: 'ADPT-260927-grp-01',
  origin: { type: 'signal', signalId: 'ADPT_2026-10-14_D_ST_TREND_RIDER_V2_LONG' },
  mode: 'paper',
  userId: 'u1',
  memberTicketIds: ['pap_ADPT-260927-sig-EQ-01'],
  memberTradeIds: ['ADPT-260927-sig-EQ-01'],
  brokerOrderIds: [],
  status: 'open',
  rollups: { openCount: 1, closedCount: 0 },
  createdAt: '2026-10-14T21:00:00Z',
  updatedAt: '2026-10-14T21:00:00Z',
};

describe('StPositionGroup', () => {
  it('carries membership + rollup fields', () => {
    for (const key of [
      'id', 'origin', 'mode', 'userId', 'memberTicketIds', 'memberTradeIds',
      'brokerOrderIds', 'status', 'rollups', 'createdAt', 'updatedAt',
    ]) {
      expect(GROUP).toHaveProperty(key);
    }
  });

  it('pins the status + origin-type value sets', () => {
    expect(ST_POSITION_GROUP_STATUSES).toEqual(['open', 'closed']);
    expect(ST_GROUP_ORIGIN_TYPES).toEqual(['signal', 'program', 'manual']);
  });

  it('serializes to JSON and round-trips intact', () => {
    expect(JSON.parse(JSON.stringify(GROUP))).toEqual(GROUP);
  });
});
