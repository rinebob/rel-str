/**
 * Gallery cards util — unit tests (#754).
 *
 * Covers the pure seams: occurrence → symbol+side card aggregation,
 * timeframe/direction/list filtering, and dimension grouping (#783).
 */
import {
  buildGalleryCards,
  filterGalleryCards,
  groupGalleryCards,
  retainGalleryCards,
  sunkGalleryGroup,
  GalleryActionContext,
  GalleryCardStatus,
  GalleryFilter,
  GalleryListContext,
  SUNK_GROUP_KEY,
} from './gallery-cards.util';
import {
  canRejectCard,
  canTradeCard,
  enrichGalleryCards,
  isSunkCard,
} from './gallery-card-actions.util';
import { StOccurrenceDecision, StSignalItem, StSymbolProfile } from '../services/types';
import { buildStOccurrenceDecisionId } from '../services/firestore-helpers';
import {
  EquityOrderTicket,
  InstrumentType,
  OrderSource,
  OrderTicket,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import {
  GroupDimension,
  NO_MEMBERSHIP,
  ReviewDecision,
  SignalDirection,
  SignalStatus,
  SignalTimeframe,
} from '../common/constants';

const RUN_ID = 'run-1';

function profile(symbol: string, extra: Partial<StSymbolProfile> = {}): StSymbolProfile {
  return { symbol, enabled: true, createdAt: '2026-01-01', ...extra };
}

function signal(
  symbol: string,
  timeframe: SignalTimeframe,
  direction: SignalDirection,
  extra: Partial<StSignalItem> = {},
): StSignalItem {
  return {
    id: '2026-08-25',
    symbol,
    barDate: '2026-08-25',
    marketDate: '2026-08-25',
    runId: RUN_ID,
    timeframe,
    direction,
    signalType: 'RS_RISE',
    status: SignalStatus.INTERIM,
    indicators: {},
    ...extra,
  };
}

const noLists: GalleryListContext = {
  symbolLists: {},
  exclusiveListKeys: [],
};

const allFilter: GalleryFilter = {
  timeframe: SignalTimeframe.ALL,
  direction: SignalDirection.ALL,
  listFilter: 'ALL',
};

/** No decisions tracked — satisfies the required `actions` param without
 *  rejecting anything. */
const noDecisions = { runId: '', decisions: {} };

describe('buildGalleryCards', () => {
  it('aggregates same-side D+W occurrences into one card per symbol', () => {
    const cards = buildGalleryCards(
      [profile('AAPL')],
      {
        AAPL: [
          signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
          signal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG, { signalType: 'RS_WEEKLY' }),
        ],
      },
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ key: 'AAPL:buy', symbol: 'AAPL', side: 'buy' });
    expect(cards[0].occurrences).toHaveLength(2);
  });

  it('emits two cards when a symbol has opposite directions', () => {
    const cards = buildGalleryCards(
      [profile('TSLA')],
      {
        TSLA: [
          signal('TSLA', SignalTimeframe.DAILY, SignalDirection.LONG),
          signal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT),
        ],
      },
    );

    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.side).sort()).toEqual(['buy', 'sell']);
  });

  it('skips symbols with no occurrences for the run', () => {
    const cards = buildGalleryCards([profile('MSFT'), profile('AAPL')], { AAPL: [signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG)] });
    expect(cards.map((c) => c.symbol)).toEqual(['AAPL']);
  });

  it('orders occurrences by barDate descending', () => {
    const cards = buildGalleryCards(
      [profile('AAPL')],
      {
        AAPL: [
          signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { barDate: '2026-08-20', id: '2026-08-20' }),
          signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { barDate: '2026-08-25', id: '2026-08-25' }),
        ],
      },
    );
    expect(cards[0].occurrences.map((o) => o.barDate)).toEqual(['2026-08-25', '2026-08-20']);
  });
});

describe('filterGalleryCards', () => {
  const cards = buildGalleryCards(
    [profile('AAPL'), profile('TSLA'), profile('MSFT')],
    {
      AAPL: [
        signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
        signal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG),
      ],
      TSLA: [signal('TSLA', SignalTimeframe.WEEKLY, SignalDirection.SHORT)],
      MSFT: [signal('MSFT', SignalTimeframe.DAILY, SignalDirection.SHORT)],
    },
  );

  it('returns all cards under the ALL/ALL/ALL filter', () => {
    expect(filterGalleryCards(cards, allFilter, noLists, noDecisions)).toHaveLength(3);
  });

  it('filters to the matching direction', () => {
    const out = filterGalleryCards(cards, { ...allFilter, direction: SignalDirection.SHORT }, noLists, noDecisions);
    expect(out.map((c) => c.symbol).sort()).toEqual(['MSFT', 'TSLA']);
  });

  it('trims occurrences to the matching timeframe and drops empty cards', () => {
    const out = filterGalleryCards(cards, { ...allFilter, timeframe: SignalTimeframe.WEEKLY }, noLists, noDecisions);
    expect(out.map((c) => c.symbol).sort()).toEqual(['AAPL', 'TSLA']);
    const aapl = out.find((c) => c.symbol === 'AAPL')!;
    expect(aapl.occurrences).toHaveLength(1);
    expect(aapl.occurrences[0].timeframe).toBe(SignalTimeframe.WEEKLY);
  });

  it('filters by named list membership', () => {
    const lists: GalleryListContext = {
      symbolLists: { PRIMARY: ['AAPL'], MONITOR: ['TSLA'] },
      exclusiveListKeys: ['PRIMARY'],
    };
    const out = filterGalleryCards(cards, { ...allFilter, listFilter: 'PRIMARY' }, lists, noDecisions);
    expect(out.map((c) => c.symbol)).toEqual(['AAPL']);
  });

  it('NO_MEMBERSHIP keeps only symbols in zero exclusive lists', () => {
    // Untriaged is derived from exclusive-list membership — no separate
    // tracked-symbols load is required (#754 review finding).
    const lists: GalleryListContext = {
      symbolLists: { PRIMARY: ['AAPL', 'MSFT'], MONITOR: ['TSLA'] },
      exclusiveListKeys: ['PRIMARY'],
    };
    const out = filterGalleryCards(cards, { ...allFilter, listFilter: NO_MEMBERSHIP }, lists, noDecisions);
    expect(out.map((c) => c.symbol)).toEqual(['TSLA']);
  });
});

describe('groupGalleryCards (#783) — mirrors signal-review buildSymbolGroups', () => {
  const cards = (syms: { s: string; p?: Partial<StSymbolProfile> }[]) =>
    buildGalleryCards(
      syms.map(({ s, p }) => profile(s, p)),
      Object.fromEntries(syms.map(({ s }) => [s, [signal(s, SignalTimeframe.DAILY, SignalDirection.LONG)]])),
    );

  it('sector: one group per sector value, alphabetical, unknown last', () => {
    const groups = groupGalleryCards(
      cards([
        { s: 'ZZZ', p: { sector: 'Tech' } },
        { s: 'AAA', p: { sector: 'Energy' } },
        { s: 'BBB', p: { sector: 'Energy' } },
        { s: 'NOSEC' },
      ]),
      GroupDimension.SECTOR,
    );
    expect(groups.map((g) => g.label)).toEqual(['Energy', 'Tech', '(Unknown)']);
    expect(groups[0].cards.map((c) => c.symbol).sort()).toEqual(['AAA', 'BBB']);
    expect(groups.map((g) => g.key)).toEqual(['sector:Energy', 'sector:Tech', 'sector:(Unknown)']);
  });

  it('industry: groups by industry value', () => {
    const groups = groupGalleryCards(
      cards([
        { s: 'AAA', p: { industry: 'Software' } },
        { s: 'BBB', p: { industry: 'Oil' } },
      ]),
      GroupDimension.INDUSTRY,
    );
    expect(groups.map((g) => g.label)).toEqual(['Oil', 'Software']);
  });

  it('marketCapTier: orders groups by tier rank and uppercases labels', () => {
    const groups = groupGalleryCards(
      cards([
        { s: 'SML', p: { marketCapTier: 'small' } },
        { s: 'MEG', p: { marketCapTier: 'mega' } },
        { s: 'NOCAP' },
      ]),
      GroupDimension.MARKET_CAP_TIER,
    );
    expect(groups.map((g) => g.label)).toEqual(['MEGA', 'SMALL', '(Unknown)']);
  });

  it('orders cards within a group by marketCap desc — same as signal-review rows', () => {
    const groups = groupGalleryCards(
      cards([
        { s: 'SMALL1', p: { sector: 'Tech', marketCap: 1 } },
        { s: 'BIG1', p: { sector: 'Tech', marketCap: 100 } },
        { s: 'NOCAP', p: { sector: 'Tech' } },
      ]),
      GroupDimension.SECTOR,
    );
    expect(groups[0].cards.map((c) => c.symbol)).toEqual(['BIG1', 'SMALL1', 'NOCAP']);
  });

  it('returns no groups for empty input', () => {
    expect(groupGalleryCards([], GroupDimension.SECTOR)).toEqual([]);
  });

  it('keeps both direction cards of a symbol in the same group', () => {
    const twoDir = buildGalleryCards(
      [profile('TSLA', { sector: 'Auto' })],
      {
        TSLA: [
          signal('TSLA', SignalTimeframe.DAILY, SignalDirection.LONG),
          signal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT),
        ],
      },
    );
    const groups = groupGalleryCards(twoDir, GroupDimension.SECTOR);
    expect(groups).toHaveLength(1);
    expect(groups[0].cards).toHaveLength(2);
  });
});

describe('action context (#755) — reject trim, status derivation, sunk model', () => {
  function decision(
    symbol: string,
    signalType: string,
    decisionType: StOccurrenceDecision['decisionType'],
    timeframe: SignalTimeframe = SignalTimeframe.DAILY,
  ): StOccurrenceDecision {
    return {
      id: buildStOccurrenceDecisionId(RUN_ID, symbol, timeframe, signalType),
      runId: RUN_ID,
      marketDate: '2026-08-25',
      symbol,
      timeframe,
      direction: SignalDirection.LONG,
      signalType,
      barDate: '2026-08-25',
      decisionType,
      decidedAt: '2026-08-26T00:00:00Z',
      isCurrentInLatestRun: true,
    };
  }

  function ticket(
    symbol: string,
    side: 'buy' | 'sell',
    status: OrderTicketStatus,
    extra: Partial<EquityOrderTicket> = {},
  ): OrderTicket {
    return {
      id: `t-${symbol}-${side}`,
      refId: 'ref-1',
      source: OrderSource.SIGNAL_PIPELINE,
      status,
      accountNumber: 'acct-1',
      side,
      orderType: 'limit',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      instrumentType: InstrumentType.EQUITY,
      symbol,
      signalContext: {
        signalType: 'RS_RISE',
        barDate: '2026-08-25',
        timeframe: 'D',
        direction: 'LONG',
        decisionId: buildStOccurrenceDecisionId(RUN_ID, symbol, 'D', 'RS_RISE'),
      },
      createdAt: '2026-08-25T00:00:00Z',
      updatedAt: '2026-08-26T00:00:00Z',
      ...extra,
    };
  }

  const noActions: GalleryActionContext = {
    runId: RUN_ID,
    decisions: {},
    ticketsBySymbol: {},
    monitorSymbols: new Set(),
  };

  function ctx(over: Partial<GalleryActionContext>): GalleryActionContext {
    return { ...noActions, ...over };
  }

  describe('filterGalleryCards — rejected occurrences', () => {
    const cards = buildGalleryCards(
      [profile('AAPL'), profile('TSLA')],
      {
        AAPL: [
          signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
          signal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG, { signalType: 'RS_WEEKLY' }),
        ],
        TSLA: [signal('TSLA', SignalTimeframe.DAILY, SignalDirection.LONG)],
      },
    );

    it('trims only the rejected occurrence; the card survives on the rest', () => {
      const decisions = {
        [decision('AAPL', 'RS_RISE', ReviewDecision.REJECT).id]:
          decision('AAPL', 'RS_RISE', ReviewDecision.REJECT),
      };
      const out = filterGalleryCards(cards, allFilter, noLists, ctx({ decisions }));
      const aapl = out.find((c) => c.symbol === 'AAPL')!;
      expect(aapl.occurrences).toHaveLength(1);
      expect(aapl.occurrences[0].signalType).toBe('RS_WEEKLY');
    });

    it('keeps a fully-rejected card so the decision stays reachable (sinks as rejected)', () => {
      const decisions = {
        [decision('TSLA', 'RS_RISE', ReviewDecision.REJECT).id]:
          decision('TSLA', 'RS_RISE', ReviewDecision.REJECT),
      };
      const out = filterGalleryCards(cards, allFilter, noLists, ctx({ decisions }));
      const tsla = out.find((c) => c.symbol === 'TSLA')!;
      expect(tsla.occurrences).toHaveLength(1);
      const [enriched] = enrichGalleryCards([tsla], ctx({ decisions }));
      expect(enriched.status).toBe('rejected');
      expect(isSunkCard(enriched)).toBe(true);
    });

    it('does not trim occurrences with ACCEPT decisions', () => {
      const decisions = {
        [decision('TSLA', 'RS_RISE', ReviewDecision.ACCEPT).id]:
          decision('TSLA', 'RS_RISE', ReviewDecision.ACCEPT),
      };
      const out = filterGalleryCards(cards, allFilter, noLists, ctx({ decisions }));
      expect(out.find((c) => c.symbol === 'TSLA')!.occurrences).toHaveLength(1);
    });
  });

  describe('enrichGalleryCards — status derivation', () => {
    const cards = buildGalleryCards(
      [profile('AAPL')],
      { AAPL: [signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG)] },
    );

    it('pending when no ticket and not watched', () => {
      const [c] = enrichGalleryCards(cards, noActions);
      expect(c.status).toBe('pending');
      expect(c.ticket).toBeUndefined();
    });

    it('maps ticket statuses to card statuses', () => {
      const cases: [OrderTicketStatus, string][] = [
        [OrderTicketStatus.SUBMITTING, 'submitting'],
        [OrderTicketStatus.SUBMITTED, 'resting'],
        [OrderTicketStatus.QUEUED, 'resting'],
        [OrderTicketStatus.RESTING, 'resting'],
        [OrderTicketStatus.FILLED, 'settled'],
        [OrderTicketStatus.PAPER, 'settled'],
        [OrderTicketStatus.FAILED, 'failed'],
        [OrderTicketStatus.CANCELLED, 'failed'],
        [OrderTicketStatus.STAGED, 'pending'],
      ];
      for (const [ticketStatus, expected] of cases) {
        const [c] = enrichGalleryCards(
          cards,
          ctx({ ticketsBySymbol: { AAPL: [ticket('AAPL', 'buy', ticketStatus)] } }),
        );
        expect(c.status).toBe(expected);
      }
    });

    it('watched when the symbol is in MONITOR, and it wins over a resting ticket', () => {
      const [c] = enrichGalleryCards(
        cards,
        ctx({
          monitorSymbols: new Set(['AAPL']),
          ticketsBySymbol: { AAPL: [ticket('AAPL', 'buy', OrderTicketStatus.RESTING)] },
        }),
      );
      expect(c.status).toBe('watched');
    });

    it('watched + all-rejected: status stays watched but allRejected is set — untradeable, restorable (#755 review)', () => {
      const reject = decision('AAPL', 'RS_RISE', ReviewDecision.REJECT);
      const [c] = enrichGalleryCards(
        filterGalleryCards(cards, allFilter, noLists, ctx({ decisions: { [reject.id]: reject } })),
        ctx({
          decisions: { [reject.id]: reject },
          monitorSymbols: new Set(['AAPL']),
        }),
      );
      expect(c.status).toBe('watched'); // Monitor precedence is the AC
      expect(c.allRejected).toBe(true);
      expect(canTradeCard(c)).toBe(false);
      expect(canRejectCard(c)).toBe(true); // Restore stays reachable
    });

    it('sets allRejected false when at least one occurrence is unrejected', () => {
      const multi = buildGalleryCards(
        [profile('AAPL')],
        {
          AAPL: [
            signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
            signal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG, { signalType: 'RS_WEEKLY' }),
          ],
        },
      );
      const reject = decision('AAPL', 'RS_RISE', ReviewDecision.REJECT);
      const [c] = enrichGalleryCards(
        filterGalleryCards(multi, allFilter, noLists, ctx({ decisions: { [reject.id]: reject } })),
        ctx({ decisions: { [reject.id]: reject } }),
      );
      expect(c.allRejected).toBe(false);
      expect(canTradeCard(c)).toBe(true);
    });

    it('allRejected verdicts the FULL set — a hidden unrejected timeframe keeps a filtered card actionable (#755 review r3)', () => {
      const multi = buildGalleryCards(
        [profile('AAPL')],
        {
          AAPL: [
            signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
            signal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG, { signalType: 'RS_WEEKLY' }),
          ],
        },
      );
      // Daily rejected, weekly still live. Under the DAILY filter the
      // visible set is all-rejected — but the reject write covered the
      // weekly leg too, so the verdict must be false.
      const reject = decision('AAPL', 'RS_RISE', ReviewDecision.REJECT);
      const actx = ctx({ decisions: { [reject.id]: reject } });
      const [c] = enrichGalleryCards(
        filterGalleryCards(multi, { ...allFilter, timeframe: SignalTimeframe.DAILY }, noLists, actx),
        actx,
      );
      expect(c.occurrences.every((o) => o.timeframe === SignalTimeframe.DAILY)).toBe(true);
      expect(c.allRejected).toBe(false);
      expect(c.status).toBe('pending');
      expect(canTradeCard(c)).toBe(true);
    });

    it('matches tickets by side — a sell ticket does not status the buy card', () => {
      const [c] = enrichGalleryCards(
        cards,
        ctx({ ticketsBySymbol: { AAPL: [ticket('AAPL', 'sell', OrderTicketStatus.FILLED)] } }),
      );
      expect(c.status).toBe('pending');
    });

    it('ignores tickets whose decisionId belongs to a different run', () => {
      const stale = ticket('AAPL', 'buy', OrderTicketStatus.FILLED, {
        signalContext: {
          signalType: 'RS_RISE',
          barDate: '2026-08-25',
          timeframe: 'D',
          direction: 'LONG',
          decisionId: buildStOccurrenceDecisionId('run-old', 'AAPL', 'D', 'RS_RISE'),
        },
      });
      const [c] = enrichGalleryCards(cards, ctx({ ticketsBySymbol: { AAPL: [stale] } }));
      expect(c.status).toBe('pending');
    });

    it('picks the latest ticket when several match the run+side', () => {
      const older = ticket('AAPL', 'buy', OrderTicketStatus.FAILED, { updatedAt: '2026-08-20T00:00:00Z' });
      const newer = ticket('AAPL', 'buy', OrderTicketStatus.RESTING, { updatedAt: '2026-08-26T00:00:00Z' });
      const [c] = enrichGalleryCards(cards, ctx({ ticketsBySymbol: { AAPL: [older, newer] } }));
      expect(c.status).toBe('resting');
      expect(c.ticket?.id).toBe(newer.id);
    });

    it('actionedAt prefers terminalAt, falls back to updatedAt, empty without a ticket', () => {
      const terminal = ticket('AAPL', 'buy', OrderTicketStatus.FILLED, {
        updatedAt: '2026-08-26T00:00:00Z',
        terminalAt: '2026-08-27T00:00:00Z',
      });
      const [c] = enrichGalleryCards(cards, ctx({ ticketsBySymbol: { AAPL: [terminal] } }));
      expect(c.actionedAt).toBe('2026-08-27T00:00:00Z');
      expect(enrichGalleryCards(cards, noActions)[0].actionedAt).toBe('');
    });

    it('matches via the decisionIds array when the scalar decisionId does not match', () => {
      const multi = ticket('AAPL', 'buy', OrderTicketStatus.RESTING, {
        signalContext: {
          signalType: 'RS_RISE',
          barDate: '2026-08-25',
          timeframe: 'D',
          direction: 'LONG',
          decisionId: buildStOccurrenceDecisionId(RUN_ID, 'AAPL', 'D', 'OTHER'),
          decisionIds: [
            buildStOccurrenceDecisionId(RUN_ID, 'AAPL', 'D', 'OTHER'),
            buildStOccurrenceDecisionId(RUN_ID, 'AAPL', 'D', 'RS_RISE'),
          ],
        },
      });
      const [c] = enrichGalleryCards(cards, ctx({ ticketsBySymbol: { AAPL: [multi] } }));
      expect(c.status).toBe('resting');
    });

    it('falls back to the scalar decisionId when decisionIds is an empty array', () => {
      const empty = ticket('AAPL', 'buy', OrderTicketStatus.RESTING, {
        signalContext: {
          signalType: 'RS_RISE',
          barDate: '2026-08-25',
          timeframe: 'D',
          direction: 'LONG',
          decisionId: buildStOccurrenceDecisionId(RUN_ID, 'AAPL', 'D', 'RS_RISE'),
          decisionIds: [],
        },
      });
      const [c] = enrichGalleryCards(cards, ctx({ ticketsBySymbol: { AAPL: [empty] } }));
      expect(c.status).toBe('resting');
    });

    it('ignores tickets with no signalContext (manual orders)', () => {
      const manual = ticket('AAPL', 'buy', OrderTicketStatus.RESTING, { signalContext: undefined });
      const [c] = enrichGalleryCards(cards, ctx({ ticketsBySymbol: { AAPL: [manual] } }));
      expect(c.status).toBe('pending');
    });

    it('ignores option tickets — they never carry signal context', () => {
      const opt = { ...ticket('AAPL', 'buy', OrderTicketStatus.RESTING), instrumentType: InstrumentType.OPTION };
      const [c] = enrichGalleryCards(cards, ctx({ ticketsBySymbol: { AAPL: [opt as OrderTicket] } }));
      expect(c.status).toBe('pending');
    });

    it('ignores a same-run ticket whose decision is not one of the card\'s occurrences', () => {
      // Exact-membership match: `runId`-prefixed is not enough — the decision
      // must be for an occurrence actually on the card (a bare startsWith
      // would match this).
      const other = ticket('AAPL', 'buy', OrderTicketStatus.RESTING, {
        signalContext: {
          signalType: 'OTHER',
          barDate: '2026-08-25',
          timeframe: 'D',
          direction: 'LONG',
          decisionId: buildStOccurrenceDecisionId(RUN_ID, 'AAPL', 'D', 'OTHER'),
        },
      });
      const [c] = enrichGalleryCards(cards, ctx({ ticketsBySymbol: { AAPL: [other] } }));
      expect(c.status).toBe('pending');
    });

    it('matches a legacy hyphen-format decisionId after canonicalization', () => {
      const legacy = ticket('AAPL', 'buy', OrderTicketStatus.RESTING, {
        signalContext: {
          signalType: 'RS_RISE',
          barDate: '2026-08-25',
          timeframe: 'D',
          direction: 'LONG',
          decisionId: `${RUN_ID}-AAPL-D-RS_RISE`,
        },
      });
      const [c] = enrichGalleryCards(cards, ctx({ ticketsBySymbol: { AAPL: [legacy] } }));
      expect(c.status).toBe('resting');
    });

    it('a ticket staged from a filter-hidden occurrence still statuses the card (#819 r2)', () => {
      const multi = buildGalleryCards(
        [profile('AAPL')],
        {
          AAPL: [
            signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
            signal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG, { signalType: 'RS_WEEKLY' }),
          ],
        },
      );
      const [trimmed] = filterGalleryCards(
        multi,
        { ...allFilter, timeframe: SignalTimeframe.DAILY },
        noLists,
        noDecisions,
      );
      expect(trimmed.occurrences).toHaveLength(1); // weekly leg hidden

      const weeklyTicket = ticket('AAPL', 'buy', OrderTicketStatus.RESTING, {
        signalContext: {
          signalType: 'RS_WEEKLY',
          barDate: '2026-08-25',
          timeframe: 'W',
          direction: 'LONG',
          decisionId: buildStOccurrenceDecisionId(RUN_ID, 'AAPL', 'W', 'RS_WEEKLY'),
        },
      });
      const [c] = enrichGalleryCards([trimmed], ctx({ ticketsBySymbol: { AAPL: [weeklyTicket] } }));
      expect(c.ticket?.id).toBe(weeklyTicket.id);
      expect(c.status).toBe('resting');
    });
  });

  describe('sunk model', () => {
    function cardWith(status: GalleryCardStatus, actionedAt = '') {
      const [c] = enrichGalleryCards(
        buildGalleryCards([profile('X')], { X: [signal('X', SignalTimeframe.DAILY, SignalDirection.LONG)] }),
        noActions,
      );
      return { ...c, status, actionedAt };
    }

    it('isSunkCard: watched/settled/failed/rejected sink; pending/submitting/resting stay', () => {
      expect(isSunkCard(cardWith('watched'))).toBe(true);
      expect(isSunkCard(cardWith('settled'))).toBe(true);
      expect(isSunkCard(cardWith('failed'))).toBe(true);
      expect(isSunkCard(cardWith('rejected'))).toBe(true);
      expect(isSunkCard(cardWith('pending'))).toBe(false);
      expect(isSunkCard(cardWith('submitting'))).toBe(false);
      expect(isSunkCard(cardWith('resting'))).toBe(false);
    });

    it('sunkGalleryGroup orders by actionedAt desc with untimestamped cards last', () => {
      const group = sunkGalleryGroup([
        cardWith('watched'),
        cardWith('settled', '2026-08-26T00:00:00Z'),
        cardWith('failed', '2026-08-27T00:00:00Z'),
      ]);
      expect(group.key).toBe(SUNK_GROUP_KEY);
      expect(group.cards.map((c) => c.status)).toEqual(['failed', 'settled', 'watched']);
    });
  });

  describe('enrichGalleryCards — actionedAt fallback (#755)', () => {
    const cards = buildGalleryCards(
      [profile('AAPL'), profile('TSLA')],
      {
        AAPL: [
          signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
          signal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG, { signalType: 'RS_WEEKLY' }),
        ],
        TSLA: [signal('TSLA', SignalTimeframe.DAILY, SignalDirection.LONG)],
      },
    );

    it('actionedAt falls back to the latest occurrence decidedAt without a ticket', () => {
      const older = {
        ...decision('TSLA', 'RS_RISE', ReviewDecision.REJECT),
        decidedAt: '2026-08-20T00:00:00Z',
      };
      const [c] = enrichGalleryCards(
        cards.filter((x) => x.symbol === 'TSLA'),
        ctx({ decisions: { [older.id]: older } }),
      );
      expect(c.actionedAt).toBe('2026-08-20T00:00:00Z');
    });

    it('actionedAt sees a decision on a filter-hidden occurrence (#819 r2)', () => {
      // D filter trims the AAPL card to its daily leg; the only decision
      // is on the hidden weekly leg — it must still timestamp the card.
      const hidden = {
        ...decision('AAPL', 'RS_WEEKLY', ReviewDecision.REJECT, SignalTimeframe.WEEKLY),
        decidedAt: '2026-08-27T00:00:00Z',
      };
      const [trimmed] = filterGalleryCards(
        cards.filter((x) => x.symbol === 'AAPL'),
        { ...allFilter, timeframe: SignalTimeframe.DAILY },
        noLists,
        noDecisions,
      );
      const [c] = enrichGalleryCards([trimmed], ctx({ decisions: { [hidden.id]: hidden } }));
      expect(c.actionedAt).toBe('2026-08-27T00:00:00Z');
    });
  });
});

describe('retainGalleryCards — identity retention across pipeline rebuilds', () => {
  const actions: GalleryActionContext = {
    runId: RUN_ID, decisions: {}, ticketsBySymbol: {}, monitorSymbols: new Set(),
  };
  const profiles = [
    profile('AAPL', { sector: 'Tech', marketCap: 100 }),
    profile('TSLA', { sector: 'Auto', marketCap: 50 }),
  ];
  const signalsBySymbol = {
    AAPL: [signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG)],
    TSLA: [signal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT)],
  };

  it('reuses card objects when nothing rendered-relevant changed', () => {
    const prev = enrichGalleryCards(
      filterGalleryCards(buildGalleryCards(profiles, signalsBySymbol), allFilter, noLists, actions),
      actions,
    );
    // Simulate a fresh pipeline pass producing new object identities with
    // equivalent content (the ticket patch path).
    const next = enrichGalleryCards(
      filterGalleryCards(buildGalleryCards(profiles, signalsBySymbol), allFilter, noLists, actions),
      actions,
    );
    expect(next[0]).not.toBe(prev[0]); // pipeline mints fresh objects…

    const retained = retainGalleryCards(prev, next);
    expect(retained[0]).toBe(prev[0]); // …but retention restores identity
    expect(retained[1]).toBe(prev[1]);
  });

  it('emits a new object for the card whose ticket/status changed', () => {
    const ctx = { runId: RUN_ID, decisions: {}, ticketsBySymbol: {}, monitorSymbols: new Set<string>() };
    const prev = enrichGalleryCards(
      filterGalleryCards(buildGalleryCards(profiles, signalsBySymbol), allFilter, noLists, ctx),
      ctx,
    );
    const ticket = {
      id: 't-1',
      symbol: 'AAPL',
      side: 'buy',
      source: OrderSource.SIGNAL_PIPELINE,
      status: OrderTicketStatus.SUBMITTING,
      signalContext: {
        signalType: 'RS_RISE',
        barDate: '2026-08-25',
        timeframe: 'D',
        direction: 'LONG',
        decisionId: buildStOccurrenceDecisionId(RUN_ID, 'AAPL', 'D', 'RS_RISE'),
      },
    } as unknown as EquityOrderTicket;
    const ctx2 = { ...ctx, ticketsBySymbol: { AAPL: [ticket] } };
    const next = enrichGalleryCards(
      filterGalleryCards(buildGalleryCards(profiles, signalsBySymbol), allFilter, noLists, ctx2),
      ctx2,
    );
    const retained = retainGalleryCards(prev, next);
    const aapl = retained.find((c) => c.symbol === 'AAPL')!;
    const tsla = retained.find((c) => c.symbol === 'TSLA')!;
    expect(aapl).not.toBe(prev.find((c) => c.symbol === 'AAPL'));
    expect(tsla).toBe(prev.find((c) => c.symbol === 'TSLA'));
  });

  it('empty prev passes next through untouched', () => {
    const next = buildGalleryCards(profiles, signalsBySymbol);
    expect(retainGalleryCards([], next)).toBe(next);
  });
});
