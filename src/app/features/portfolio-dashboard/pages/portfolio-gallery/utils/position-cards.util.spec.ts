/**
 * Specs for position-gallery card mapping utilities (#926/#950).
 *
 * buildPositionCards joins the dashboard store's equity positions (withPnL)
 * with quotes, live orders, symbol profiles, and allocation bucket names
 * into PositionCard view-models. Every input is nullable-degraded — a
 * missing quote/profile/bucket produces null fields, never a missing card.
 */
import { EquityPositionWithPnL } from '../../../portfolio-dashboard.types';
import {
  EquityQuote,
  BrokerOrder,
} from '../../../../../core/robinhood-mcp/types/robinhood-mcp.types';
import type { StSymbolProfile } from '../../../../savant-trader/services/types';
import {
  makeEquityPosition,
  makeEquityQuote,
  makeOrder,
} from '../../../portfolio-dashboard.spec-fixtures';
import {
  buildPositionCards,
  filterPositionCards,
  sortFlatPositionCards,
  daysHeldFromEntry,
  PositionCard,
  PositionCardFilter,
} from './position-cards.util';

const NOW = new Date('2026-10-11T18:00:00Z');

function makePosition(overrides: Partial<EquityPositionWithPnL> = {}): EquityPositionWithPnL {
  return {
    ...makeEquityPosition(),
    currentPrice: 155,
    pnl: 500,
    pnlPercent: 3.333,
    closed: false,
    entryDate: '2026-10-01T14:00:00Z',
    ...overrides,
  };
}

function makeProfile(overrides: Partial<StSymbolProfile> = {}): StSymbolProfile {
  return {
    symbol: 'AAPL',
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    name: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    marketCap: 3.5e12,
    marketCapTier: 'mega',
    ...overrides,
  };
}

const NO_FILTERS: PositionCardFilter = { side: 'all', listFilter: 'ALL' };
const NO_LISTS = { symbolLists: {}, exclusiveListKeys: [] as string[] };

function buildOne(overrides: {
  position?: Partial<EquityPositionWithPnL>;
  quote?: EquityQuote | null;
  orders?: BrokerOrder[];
  profile?: StSymbolProfile | null;
  bucketName?: string | null;
} = {}): PositionCard {
  const position = makePosition(overrides.position);
  const quote = overrides.quote === undefined ? makeEquityQuote() : overrides.quote;
  const profile = overrides.profile === undefined ? makeProfile() : overrides.profile;
  const profiles = profile ? new Map([[profile.symbol.toUpperCase(), profile]]) : new Map<string, StSymbolProfile>();
  const buckets = overrides.bucketName ? new Map([[position.symbol, overrides.bucketName]]) : new Map<string, string>();
  return buildPositionCards(
    '123456789',
    [position],
    quote ? new Map([[quote.symbol, quote]]) : null,
    overrides.orders ?? [],
    profiles,
    buckets,
    NOW,
  )[0];
}

describe('daysHeldFromEntry', () => {
  it('returns calendar days between entry and now', () => {
    expect(daysHeldFromEntry('2026-10-01T14:00:00Z', NOW)).toBe(10);
    expect(daysHeldFromEntry('2026-10-11T00:00:00Z', NOW)).toBe(0);
  });

  it('returns null without an entry date', () => {
    expect(daysHeldFromEntry(null, NOW)).toBeNull();
  });
});

describe('buildPositionCards', () => {
  it('joins position, quote, profile, and bucket into one card', () => {
    const card = buildOne({ bucketName: 'Growth' });
    expect(card.key).toBe('123456789:AAPL');
    expect(card.symbol).toBe('AAPL');
    expect(card.side).toBe('long');
    expect(card.quantity).toBe(100);
    expect(card.averageCost).toBe(150);
    expect(card.marketPrice).toBe(155);
    expect(card.unrealizedPnl).toBe(500);
    expect(card.unrealizedPnlPct).toBe(3.333);
    expect(card.marketValue).toBe(15500);
    expect(card.daysHeld).toBe(10);
    expect(card.bucketName).toBe('Growth');
    expect(card.companyName).toBe('Apple Inc.');
    expect(card.sector).toBe('Technology');
    expect(card.industry).toBe('Consumer Electronics');
    expect(card.capTier).toBe('mega');
    expect(card.marketCap).toBe(3.5e12);
  });

  it('computes day change from lastTradePrice vs previousClose', () => {
    const card = buildOne();
    expect(card.dayChange).toBeCloseTo(3);
    expect(card.dayChangePct).toBeCloseTo((3 / 152) * 100);
  });

  it('derives side from quantity sign', () => {
    const card = buildOne({ position: { quantity: -40 } });
    expect(card.side).toBe('short');
  });

  it('degrades to null price fields when the quote is missing', () => {
    const card = buildOne({ quote: null, position: { currentPrice: null, pnl: null, pnlPercent: null } });
    expect(card.marketPrice).toBeNull();
    expect(card.dayChange).toBeNull();
    expect(card.dayChangePct).toBeNull();
    expect(card.marketValue).toBeNull();
    expect(card.unrealizedPnl).toBeNull();
  });

  it('degrades day change when previousClose is null', () => {
    const card = buildOne({ quote: makeEquityQuote({ previousClose: null }) });
    expect(card.dayChange).toBeNull();
    expect(card.dayChangePct).toBeNull();
  });

  it('degrades meta fields when the profile is missing — card still builds', () => {
    const card = buildOne({ profile: null });
    expect(card.companyName).toBeNull();
    expect(card.sector).toBeNull();
    expect(card.marketCap).toBeNull();
    expect(card.marketPrice).toBe(155);
  });

  it('reports bucketName null when the position is unattributed', () => {
    const card = buildOne();
    expect(card.bucketName).toBeNull();
  });

  it('marks the card protected with stop price and distance when a protective stop rests', () => {
    const stop = makeOrder({ side: 'sell', type: 'stop_market', state: 'confirmed', price: null, stopPrice: 145 });
    const card = buildOne({ orders: [stop] });
    expect(card.protected).toBe(true);
    expect(card.stopPrice).toBe(145);
    expect(card.stopDistancePct).toBeCloseTo(((155 - 145) / 155) * 100);
  });

  it('a short is never protected — sell-side stop detection is long-only', () => {
    const stop = makeOrder({ side: 'sell', type: 'stop_market', state: 'confirmed', stopPrice: 140 });
    const cards = buildPositionCards(
      'acct',
      [makePosition({ symbol: 'TSLA', quantity: -5, currentPrice: 155 })],
      null,
      [stop],
      new Map(),
      new Map(),
      NOW,
    );
    expect(cards[0].side).toBe('short');
    expect(cards[0].protected).toBe(false);
    expect(cards[0].stopPrice).toBeNull();
  });

  it('marks the card unprotected when only non-stop orders rest', () => {
    const limit = makeOrder({ side: 'sell', type: 'limit', state: 'confirmed', price: 170 });
    const card = buildOne({ orders: [limit] });
    expect(card.protected).toBe(false);
    expect(card.stopPrice).toBeNull();
    expect(card.stopDistancePct).toBeNull();
  });

  it('carries the symbol live equity orders for the orders popup', () => {
    const stop = makeOrder({ orderId: 'o1', side: 'sell', type: 'stop_market', state: 'confirmed', stopPrice: 145 });
    const limit = makeOrder({ orderId: 'o2', side: 'sell', type: 'limit', state: 'confirmed', price: 170 });
    const otherSymbol = makeOrder({ orderId: 'o3', symbol: 'MSFT', side: 'sell', type: 'limit', state: 'confirmed' });
    const optionOrder = makeOrder({ orderId: 'o4', instrumentType: 'option', side: 'sell', type: 'limit', state: 'confirmed' });
    const card = buildOne({ orders: [stop, limit, otherSymbol, optionOrder] });
    expect(card.openOrders.map((o) => o.orderId)).toEqual(['o1', 'o2']);
  });

  it('returns a card for every position including missing-everything ones', () => {
    const cards = buildPositionCards(
      'acct',
      [makePosition({ symbol: 'AAPL' }), makePosition({ symbol: 'MSFT', entryDate: null, currentPrice: null })],
      null,
      [],
      new Map(),
      new Map(),
      NOW,
    );
    expect(cards.length).toBe(2);
    expect(cards[1].daysHeld).toBeNull();
    expect(cards[1].marketPrice).toBeNull();
  });

  it('produces no card for closed positions — a card exists while shares are held', () => {
    const cards = buildPositionCards(
      'acct',
      [
        makePosition({ symbol: 'AAPL' }),
        makePosition({ symbol: 'MU', quantity: 0, closed: true, averageBuyPrice: null }),
        makePosition({ symbol: 'LRCX', quantity: null, closed: true }),
      ],
      null,
      [],
      new Map(),
      new Map(),
      NOW,
    );
    expect(cards.map((c) => c.symbol)).toEqual(['AAPL']);
  });
});

describe('filterPositionCards', () => {
  const cards = [
    buildPositionCards('a', [makePosition({ symbol: 'AAPL', quantity: 10 })], null, [], new Map(), new Map(), NOW),
    buildPositionCards('a', [makePosition({ symbol: 'MSFT', quantity: -5 })], null, [], new Map(), new Map(), NOW),
  ].flat();

  it('filters by side', () => {
    expect(filterPositionCards(cards, { ...NO_FILTERS, side: 'long' }, NO_LISTS).map((c) => c.symbol)).toEqual(['AAPL']);
    expect(filterPositionCards(cards, { ...NO_FILTERS, side: 'short' }, NO_LISTS).map((c) => c.symbol)).toEqual(['MSFT']);
    expect(filterPositionCards(cards, NO_FILTERS, NO_LISTS).length).toBe(2);
  });

  it('filters by symbol-list membership', () => {
    const lists = { symbolLists: { PRIMARY: ['AAPL'] }, exclusiveListKeys: ['PRIMARY'] };
    const out = filterPositionCards(cards, { ...NO_FILTERS, listFilter: 'PRIMARY' }, lists);
    expect(out.map((c) => c.symbol)).toEqual(['AAPL']);
  });
});

describe('sortFlatPositionCards', () => {
  it('orders by company market cap desc — not position market value', () => {
    const small = buildPositionCards(
      'a', [makePosition({ symbol: 'SMALL', quantity: 10000 })], null, [],
      new Map([['SMALL', makeProfile({ symbol: 'SMALL', marketCap: 1e9 })]]),
      new Map(), NOW,
    )[0];
    const big = buildPositionCards(
      'a', [makePosition({ symbol: 'BIG', quantity: 1 })], null, [],
      new Map([['BIG', makeProfile({ symbol: 'BIG', marketCap: 3e12 })]]),
      new Map(), NOW,
    )[0];
    const out = sortFlatPositionCards([small, big]);
    expect(out.map((c) => c.symbol)).toEqual(['BIG', 'SMALL']);
  });

  it('sorts null marketCap last and ties by symbol', () => {
    const noCap = buildPositionCards(
      'a', [makePosition({ symbol: 'NOCAP' })], null, [], new Map(), new Map(), NOW,
    )[0];
    const a = buildPositionCards(
      'a', [makePosition({ symbol: 'AAA' })], null, [],
      new Map([['AAA', makeProfile({ symbol: 'AAA', marketCap: 5e9 })]]), new Map(), NOW,
    )[0];
    const out = sortFlatPositionCards([noCap, a]);
    expect(out.map((c) => c.symbol)).toEqual(['AAA', 'NOCAP']);
  });
});
