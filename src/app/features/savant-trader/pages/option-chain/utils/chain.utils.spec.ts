import { buildChainGrid, type ChainGridModel, type ChainGridRow, type ChainCell } from './chain.utils';
import type { HistoricalOptionContract } from '@options-contract/contracts';
import { OptionType } from '@options-contract/contracts';

function oc(over: Partial<HistoricalOptionContract> = {}): HistoricalOptionContract {
  return {
    contractID: 'SPY_2026-10-16_600C',
    symbol: 'SPY',
    expiration: '2026-10-16',
    strike: '600',
    type: OptionType.CALL,
    mark: '2.50',
    implied_volatility: '0.32',
    delta: '0.55',
    ...over,
  };
}

function cells(model: ChainGridModel): (string | null)[][] {
  return model.rows.map((r: ChainGridRow) =>
    r.cells.map((c: ChainCell | null) => (c ? c.contractID : null)),
  );
}

describe('buildChainGrid', () => {
  it('groups contracts into strike rows × expiration columns, sorted', () => {
    const model = buildChainGrid(
      [
        oc({ contractID: 'a', strike: '605', expiration: '2026-11-20' }),
        oc({ contractID: 'b', strike: '600', expiration: '2026-10-16' }),
        oc({ contractID: 'c', strike: '600', expiration: '2026-11-20' }),
        oc({ contractID: 'd', strike: '605', expiration: '2026-10-16' }),
      ],
      [],
      OptionType.CALL,
    );

    expect(model.expirations).toEqual(['2026-10-16', '2026-11-20']);
    expect(model.rows.map((r: ChainGridRow) => r.strike)).toEqual([605, 600]); // desc: high strike at top
    expect(cells(model)).toEqual([
      ['d', 'a'],
      ['b', 'c'],
    ]);
  });

  it('normalizes AV type variants — C/Call/CALL all match the call side', () => {
    const model = buildChainGrid(
      [
        oc({ contractID: 'a', type: 'C' as OptionType }),
        oc({ contractID: 'b', strike: '605', type: 'Call' as OptionType }),
        oc({ contractID: 'c', strike: '610', type: OptionType.PUT }),
      ],
      [],
      OptionType.CALL,
    );
    expect(cells(model)).toEqual([['b'], ['a']]);
  });

  it('treats empty-string fields as missing, not zero', () => {
    const model = buildChainGrid(
      [oc({ mark: '', delta: '', implied_volatility: '' })],
      [],
      OptionType.CALL,
    );
    const cell = model.rows[0].cells[0];
    expect(cell?.mark).toBeNull();
    expect(cell?.markText).toBe('n/a');
    expect(cell?.deltaText).toBe('n/a');
    expect(cell?.ivText).toBe('n/a');
  });

  it('filters to the requested side only', () => {
    const model = buildChainGrid(
      [
        oc({ contractID: 'call', type: OptionType.CALL }),
        oc({ contractID: 'put', type: OptionType.PUT }),
      ],
      [],
      OptionType.PUT,
    );

    expect(cells(model)).toEqual([['put']]);
  });

  it('leaves null holes for strike/expiration combos with no contract', () => {
    const model = buildChainGrid(
      [
        oc({ contractID: 'a', strike: '600', expiration: '2026-10-16' }),
        oc({ contractID: 'b', strike: '605', expiration: '2026-11-20' }),
      ],
      [],
      OptionType.CALL,
    );

    expect(cells(model)).toEqual([
      [null, 'b'],
      ['a', null],
    ]);
  });

  it('shows mark as a dollar price', () => {
    const model = buildChainGrid([oc({ mark: '2.5' })], [], OptionType.CALL);
    expect(model.rows[0].cells[0]?.markText).toBe('$2.50');
  });

  it('shows n/a when mark is missing — no fallback to last', () => {
    const model = buildChainGrid(
      [oc({ mark: undefined, last: '9.99' })],
      [],
      OptionType.CALL,
    );
    const cell = model.rows[0].cells[0];
    expect(cell?.mark).toBeNull();
    expect(cell?.markText).toBe('n/a');
  });

  it('computes chg $ and chg % against the prior session matched by contractID', () => {
    const model = buildChainGrid(
      [oc({ contractID: 'a', mark: '2.75' })],
      [oc({ contractID: 'a', mark: '2.50' })],
      OptionType.CALL,
    );
    const cell = model.rows[0].cells[0];
    expect(cell?.chgAbs).toBeCloseTo(0.25);
    expect(cell?.chgPct).toBeCloseTo(0.1);
    expect(cell?.chgText).toBe('+$0.25 / +10.0%');
  });

  it('shows chg n/a when the prior session has no matching contract', () => {
    const model = buildChainGrid(
      [oc({ contractID: 'a' })],
      [oc({ contractID: 'other' })],
      OptionType.CALL,
    );
    expect(model.rows[0].cells[0]?.chgText).toBe('n/a');
  });

  it('shows chg n/a when the prior contract has no mark', () => {
    const model = buildChainGrid(
      [oc({ contractID: 'a' })],
      [oc({ contractID: 'a', mark: undefined })],
      OptionType.CALL,
    );
    expect(model.rows[0].cells[0]?.chgText).toBe('n/a');
  });

  it('shows delta and IV (as percent); missing greeks show n/a', () => {
    const model = buildChainGrid(
      [
        oc({ contractID: 'a', delta: '-0.32', implied_volatility: '0.415' }),
        oc({ contractID: 'b', strike: '601', delta: undefined, implied_volatility: undefined }),
      ],
      [],
      OptionType.CALL,
    );
    const flat = model.rows.flatMap((r: ChainGridRow) => r.cells);
    const a = flat.find((c: ChainCell | null) => c?.contractID === 'a');
    const b = flat.find((c: ChainCell | null) => c?.contractID === 'b');
    expect(a?.deltaText).toBe('-0.32');
    expect(a?.ivText).toBe('41.5%');
    expect(b?.deltaText).toBe('n/a');
    expect(b?.ivText).toBe('n/a');
  });

  it('shows chg$ with n/a pct when prior mark is zero', () => {
    const model = buildChainGrid(
      [oc({ contractID: 'a', mark: '2.50' })],
      [oc({ contractID: 'a', mark: '0' })],
      OptionType.CALL,
    );
    const cell = model.rows[0].cells[0];
    expect(cell?.chgAbs).toBeCloseTo(2.5);
    expect(cell?.chgPct).toBeNull();
    expect(cell?.chgText).toBe('+$2.50 / n/a');
  });

  it('clamps sub-cent float noise in chg to zero', () => {
    const model = buildChainGrid(
      [oc({ contractID: 'a', mark: '2.5' })],
      [oc({ contractID: 'a', mark: '2.5000000000001' })],
      OptionType.CALL,
    );
    const cell = model.rows[0].cells[0];
    expect(cell?.chgAbs).toBe(0);
    expect(cell?.chgText).toBe('+$0.00 / +0.0%');
  });

  it('skips contracts missing contractID, strike, or expiration', () => {
    const model = buildChainGrid(
      [
        oc({ contractID: undefined }),
        oc({ contractID: 'x', strike: undefined }),
        oc({ contractID: 'y', expiration: undefined }),
        oc({ contractID: 'ok' }),
      ],
      [],
      OptionType.CALL,
    );
    expect(cells(model)).toEqual([['ok']]);
  });

  it('ascending orientation flips the strike order (default is desc)', () => {
    const contracts = [
      oc({ contractID: 'a', strike: '595' }),
      oc({ contractID: 'b', strike: '600' }),
      oc({ contractID: 'c', strike: '605' }),
    ];
    expect(
      buildChainGrid(contracts, [], OptionType.CALL).rows.map((r: ChainGridRow) => r.strike),
    ).toEqual([605, 600, 595]);
    expect(
      buildChainGrid(contracts, [], OptionType.CALL, { orientation: 'asc' }).rows.map((r: ChainGridRow) => r.strike),
    ).toEqual([595, 600, 605]);
  });

  it('returns an empty model for no contracts', () => {
    const model = buildChainGrid([], [], OptionType.CALL);
    expect(model.expirations).toEqual([]);
    expect(model.rows).toEqual([]);
  });

  it('marks the strike nearest spot as atmStrike', () => {
    const model = buildChainGrid(
      [
        oc({ contractID: 'a', strike: '595' }),
        oc({ contractID: 'b', strike: '600' }),
        oc({ contractID: 'c', strike: '605' }),
      ],
      [],
      OptionType.CALL,
      { spot: 601 },
    );
    expect(model.atmStrike).toBe(600);
  });

  it('atmStrike is null without a spot price or with no strikes', () => {
    expect(buildChainGrid([oc()], [], OptionType.CALL).atmStrike).toBeNull();
    expect(buildChainGrid([], [], OptionType.CALL, { spot: 600 }).atmStrike).toBeNull();
  });

  describe('atmSymmetric window', () => {
    const strikesOf = (m: ChainGridModel) => m.rows.map((r) => r.strike);

    it('slices the long side so strikes balance above and below ATM', () => {
      const session = [550, 560, 570, 580, 590, 600, 610, 620].map((s) =>
        oc({ contractID: `s${s}`, strike: String(s) }),
      );
      // spot 585 → atm 590 (first in desc order wins the 5-vs-5 tie):
      // 3 above, 4 below → keep 3 each side.
      const m = buildChainGrid(session, [], OptionType.CALL, { spot: 585 });
      expect(m.atmStrike).toBe(590);
      expect(strikesOf(m)).toEqual([620, 610, 600, 590, 580, 570, 560]); // desc
    });

    it('excess above ATM is sliced equally', () => {
      const session = [600, 610, 620, 630, 640, 650, 660].map((s) =>
        oc({ contractID: `s${s}`, strike: String(s) }),
      );
      // spot 601 → atm 600: 0 below, 6 above → nothing above survives either.
      const m = buildChainGrid(session, [], OptionType.CALL, { spot: 601 });
      expect(strikesOf(m)).toEqual([600]);
    });

    it('off by default only when atmSymmetric is false or no spot', () => {
      const session = [550, 600, 610, 620].map((s) =>
        oc({ contractID: `s${s}`, strike: String(s) }),
      );
      const wide = buildChainGrid(session, [], OptionType.CALL, {
        spot: 605,
        atmSymmetric: false,
      });
      expect(strikesOf(wide).length).toBe(4);
      const noSpot = buildChainGrid(session, [], OptionType.CALL);
      expect(strikesOf(noSpot).length).toBe(4);
    });
  });

  describe('excludeExpirations', () => {
    it('drops hidden columns; cells realign to surviving expirations', () => {
      const session = [
        oc({ contractID: 'a', expiration: '2026-10-16' }),
        oc({ contractID: 'b', expiration: '2026-11-20' }),
        oc({ contractID: 'c', expiration: '2026-12-18' }),
      ];
      const m = buildChainGrid(session, [], OptionType.CALL, {
        filter: { excludeExpirations: new Set(['2026-11-20']) },
      });
      expect(m.expirations).toEqual(['2026-10-16', '2026-12-18']);
      expect(m.rows[0].cells.length).toBe(2);
      expect(m.rows[0].cells[0]?.contractID).toBe('a');
      expect(m.rows[0].cells[1]?.contractID).toBe('c');
    });
  });

  describe('deltaShaded', () => {
    const shaded = (delta: string | undefined) =>
      buildChainGrid([oc({ delta })], [], OptionType.CALL).rows[0]?.cells[0]
        ?.deltaShaded;

    it('shades odd |delta| tenths, leaves even ones flat (1.0 folds into 0.9x)', () => {
      expect(shaded('0.05')).toBe(false);
      expect(shaded('0.15')).toBe(true);
      expect(shaded('0.25')).toBe(false);
      expect(shaded('0.35')).toBe(true); // also covers put-side via abs()
      expect(shaded('-0.35')).toBe(true);
      expect(shaded('0.55')).toBe(true);
      expect(shaded('0.75')).toBe(true);
      expect(shaded('0.95')).toBe(true);
      expect(shaded('1.0')).toBe(true);
      expect(shaded('0.85')).toBe(false);
      expect(shaded(undefined)).toBe(false);
    });
  });

  describe('delta filter', () => {
    const contracts = () => [
      oc({ contractID: 'low', strike: '595', delta: '0.20' }),
      oc({ contractID: 'mid', strike: '600', delta: '-0.55' }),
      oc({ contractID: 'high', strike: '605', delta: '0.85' }),
      oc({ contractID: 'nod', strike: '610', delta: undefined }),
    ];
    const ids = (m: ChainGridModel) =>
      m.rows.flatMap((r) => r.cells).map((c) => c?.contractID);

    it('drops cells outside |delta| bounds — strikes with no survivors vanish', () => {
      const m = buildChainGrid(contracts(), [], OptionType.CALL, {
        filter: { deltaLte: 0.6 },
      });
      expect(ids(m)).toEqual(['mid', 'low']);
      expect(m.rows.map((r) => r.strike)).toEqual([600, 595]);
    });

    it('missing delta fails the filter when a bound is set', () => {
      const m = buildChainGrid(contracts(), [], OptionType.CALL, {
        filter: { deltaLte: 0.6 },
      });
      expect(ids(m)).not.toContain('nod');
    });

    it('no bounds keeps every cell', () => {
      const m = buildChainGrid(contracts(), [], OptionType.CALL);
      expect(ids(m).sort()).toEqual(['high', 'low', 'mid', 'nod']);
    });
  });
});
