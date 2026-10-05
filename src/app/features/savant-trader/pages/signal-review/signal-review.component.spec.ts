import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';

import { SignalReviewComponent } from './signal-review.component';
import { SignalReviewFacade } from '../../stores/signal-review.facade';
import type { SymbolGroup, SymbolRow } from '../../stores/group.store';
import { ReviewDecision } from '../../common/constants';

function makeRow(symbol: string): SymbolRow {
  return {
    profile: { symbol } as SymbolRow['profile'],
    hasSignal: true,
    reviewStatus: ReviewDecision.PENDING,
    isReviewed: false,
  };
}

function makeGroup(key: string, symbols: string[]): SymbolGroup {
  return {
    key,
    label: key,
    rows: symbols.map(makeRow),
    longCount: 0,
    shortCount: 0,
  };
}

describe('SignalReviewComponent navigation', () => {
  let component: SignalReviewComponent;
  let facade: any;

  async function setup(opts: {
    flat: string[];
    current: string | null;
    groups?: SymbolGroup[];
    expanded?: Record<string, boolean>;
  }): Promise<void> {
    facade = {
      flatSymbols: signal(opts.flat),
      quickChartSymbol: signal(opts.current),
      groups: signal(opts.groups ?? []),
      expandedGroups: signal(opts.expanded ?? {}),
      groupExpandChanged: jest.fn(),
      setQuickChartSymbol: jest.fn(),
      scrollToSymbol: jest.fn(),
      enterPage: jest.fn(),
      leavePage: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [SignalReviewComponent],
      providers: [{ provide: SignalReviewFacade, useValue: facade }],
    })
      .overrideComponent(SignalReviewComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
    component = TestBed.createComponent(SignalReviewComponent).componentInstance;
  }

  it('expands a collapsed group containing the next symbol before scrolling', async () => {
    await setup({
      flat: ['AAA', 'BBB'],
      current: 'AAA',
      groups: [makeGroup('g1', ['AAA']), makeGroup('g2', ['BBB'])],
      expanded: { g1: true, g2: false },
    });
    const group2 = facade.groups()[1];

    component.navigateNext();

    expect(facade.groupExpandChanged).toHaveBeenCalledWith(group2, true);
    expect(facade.setQuickChartSymbol).toHaveBeenCalledWith('BBB');
    expect(facade.scrollToSymbol).toHaveBeenCalledWith('BBB');
  });

  it('does not touch expansion when the target group is already expanded', async () => {
    await setup({
      flat: ['AAA', 'BBB'],
      current: 'AAA',
      groups: [makeGroup('g1', ['AAA', 'BBB'])],
      expanded: { g1: true },
    });

    component.navigateNext();

    expect(facade.groupExpandChanged).not.toHaveBeenCalled();
    expect(facade.setQuickChartSymbol).toHaveBeenCalledWith('BBB');
  });

  it('expands a collapsed group on previous-navigation too', async () => {
    await setup({
      flat: ['AAA', 'BBB'],
      current: 'BBB',
      groups: [makeGroup('g1', ['AAA']), makeGroup('g2', ['BBB'])],
      expanded: { g1: false, g2: true },
    });

    component.navigatePrev();

    expect(facade.groupExpandChanged).toHaveBeenCalledWith(facade.groups()[0], true);
    expect(facade.setQuickChartSymbol).toHaveBeenCalledWith('AAA');
  });

  it('no-ops at the list edges', async () => {
    await setup({
      flat: ['AAA'], current: 'AAA',
      groups: [makeGroup('g1', ['AAA'])], expanded: { g1: true },
    });
    component.navigatePrev();
    component.navigateNext();
    expect(facade.setQuickChartSymbol).not.toHaveBeenCalled();
  });

  it('no-ops on an empty flat list', async () => {
    await setup({ flat: [], current: null });
    component.navigateNext();
    component.navigatePrev();
    expect(facade.setQuickChartSymbol).not.toHaveBeenCalled();
    expect(facade.groupExpandChanged).not.toHaveBeenCalled();
  });
});
