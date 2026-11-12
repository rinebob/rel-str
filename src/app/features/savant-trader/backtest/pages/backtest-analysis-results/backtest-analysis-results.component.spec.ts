import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, convertToParamMap, ParamMap } from '@angular/router';
import { Subject } from 'rxjs';

import { BacktestAnalysisResultsComponent } from './backtest-analysis-results.component';
import { OptionsAnalysisRunsService } from '../../services/options-analysis-runs.service';
import { OptionsReplayRunsService } from '../../services/options-replay-runs.service';
import { EXIT_REGISTRY_VERSION } from '@options-analysis/registry';
import type {
  AnalysisErrorTrade,
  AnalysisExitTrade,
  AnalysisExpiredTrade,
  AnalysisOpenTrade,
  AnalysisResultDoc,
  ExitTypeAggregate,
} from '@options-analysis/contracts';
import type { OptionsReplayRunUi } from '../../common/options-replay.types';

function makeAggregate(overrides: Partial<ExitTypeAggregate> = {}): ExitTypeAggregate {
  return {
    exitId: 'target-90',
    contractCount: 10,
    exitedCount: 7,
    expiredCount: 2,
    openCount: 1,
    errorCount: 1,
    hitRatePct: 77.8,
    avgDaysToExit: 12.4,
    avgPremiumCapturedPct: 91.5,
    worstMae: 1.85,
    ...overrides,
  };
}

// Per-variant factories — one per union member so specs can't fabricate
// union-impossible shapes (AnalysisTradeBase isn't exported; the common
// fields are inlined here).
const tradeBase = () => ({
  runId: 'run-1',
  symbol: 'SPY',
  templateId: 'csp-45-20',
  contractListDocId: 'run-1_SPY',
  exitId: 'target-90',
  pickDate: '2026-06-10',
  contractId: 'SPY260619P00500000',
  entryMark: 2.5,
  daysHeld: 9,
  mae: { value: 1.2, date: '2026-06-12' },
  mfe: { value: 3.1, date: '2026-06-18' },
});

function makeExitRecord(overrides: Partial<AnalysisExitTrade> = {}): AnalysisExitTrade {
  return { ...tradeBase(), outcome: 'exit', exitDate: '2026-06-19', exitPrice: 0.25, ...overrides };
}

function makeExpiredRecord(overrides: Partial<AnalysisExpiredTrade> = {}): AnalysisExpiredTrade {
  return {
    ...tradeBase(),
    outcome: 'expired',
    expiredItm: true,
    intrinsicAtExpiry: 4.2,
    assignmentDistancePct: 0.84,
    ...overrides,
  };
}

function makeOpenRecord(overrides: Partial<AnalysisOpenTrade> = {}): AnalysisOpenTrade {
  return {
    ...tradeBase(),
    outcome: 'open',
    lastBarDate: '2026-06-18',
    ...overrides,
  };
}

function makeErrorRecord(overrides: Partial<AnalysisErrorTrade> = {}): AnalysisErrorTrade {
  // Contract: error records carry the entry-day excursion placeholder.
  return {
    ...tradeBase(),
    outcome: 'error',
    error: 'no series',
    daysHeld: 0,
    mae: { value: 2.5, date: '2026-06-10' },
    mfe: { value: 2.5, date: '2026-06-10' },
    ...overrides,
  };
}

function makeDoc(overrides: Partial<AnalysisResultDoc> = {}): AnalysisResultDoc {
  return {
    contractListDocId: 'run-1_SPY',
    runId: 'run-1',
    symbol: 'SPY',
    templateId: 'csp-45-20',
    exitId: 'target-90',
    registryVersion: EXIT_REGISTRY_VERSION,
    status: 'success',
    trades: [],
    aggregate: makeAggregate(),
    generatedAt: '2026-11-05T00:00:00Z',
    ...overrides,
  };
}

describe('BacktestAnalysisResultsComponent', () => {
  let docsSubject: Subject<AnalysisResultDoc[]>;
  let paramSubject: Subject<ParamMap>;
  let runSubject: Subject<OptionsReplayRunUi | null>;

  async function setup(listDocId: string | null = 'run-1_SPY') {
    docsSubject = new Subject();
    paramSubject = new Subject();
    runSubject = new Subject();
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ActivatedRoute, useValue: { paramMap: paramSubject.asObservable() } },
        {
          provide: OptionsAnalysisRunsService,
          useValue: { watchListResultDocs: jest.fn(() => docsSubject.asObservable()) },
        },
        {
          provide: OptionsReplayRunsService,
          useValue: { watchRunDoc: jest.fn(() => runSubject.asObservable()) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(BacktestAnalysisResultsComponent);
    paramSubject.next(convertToParamMap(listDocId === null ? {} : { listDocId }));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, component: fixture.componentInstance };
  }

  const rows = (el: HTMLElement, sel: string) =>
    Array.from(el.querySelectorAll<HTMLElement>(sel));

  it('exposes the listDocId route param and watches docs for it', async () => {
    const { component } = await setup();
    expect(component.listDocId()).toBe('run-1_SPY');
    const service = TestBed.inject(OptionsAnalysisRunsService);
    expect(service.watchListResultDocs).toHaveBeenCalledWith('run-1_SPY');
  });

  it('rebinds the stream when the route param changes', async () => {
    const { fixture } = await setup();
    const service = TestBed.inject(OptionsAnalysisRunsService);

    paramSubject.next(convertToParamMap({ listDocId: 'run-2_QQQ' }));
    fixture.detectChanges();

    expect(service.watchListResultDocs).toHaveBeenCalledWith('run-2_QQQ');
  });

  it('shows a loading state before the first emission', async () => {
    const { el } = await setup();
    expect(el.querySelector('.state-note')?.textContent).toContain('Loading');
  });

  it('shows an empty state when no result docs exist', async () => {
    const { el, fixture } = await setup();
    docsSubject.next([]);
    fixture.detectChanges();
    expect(el.querySelector('.state-note')?.textContent).toContain('No analysis results');
  });

  it('renders the aggregate table — one row per registry strategy in order, stats bound', async () => {
    const { el, fixture } = await setup();
    docsSubject.next([makeDoc()]);
    fixture.detectChanges();

    const agg = rows(el, '.agg-table tbody tr');
    expect(agg.length).toBe(6);

    const first = agg[0].textContent!;
    expect(first).toContain('Target 90% premium');
    expect(first).toContain('77.8'); // hit rate
    expect(first).toContain('12.4'); // avg days
    expect(first).toContain('91.5'); // avg premium
    expect(first).toContain('1.85'); // worst MAE

    // Registry order — hold-to-expiry last.
    expect(agg[5].textContent).toContain('Hold to expiration');
    // Missing docs render '—' stats, never NaN/undefined.
    expect(agg[5].textContent).toContain('—');
    expect(agg[5].textContent).not.toContain('NaN');
  });

  it('a success doc with an absent optional stat renders —, not NaN', async () => {
    const { el, fixture } = await setup();
    docsSubject.next([makeDoc({ aggregate: makeAggregate({ avgDaysToExit: undefined }) })]);
    fixture.detectChanges();

    const first = rows(el, '.agg-table tbody tr')[0].textContent!;
    expect(first).toContain('—');
    expect(first).not.toContain('NaN');
  });

  it('a doc written under an older registry version renders a stale badge', async () => {
    const { el, fixture } = await setup();
    docsSubject.next([
      makeDoc({ registryVersion: EXIT_REGISTRY_VERSION - 1 }),
      makeDoc({ exitId: 'dte-21' }),
    ]);
    fixture.detectChanges();

    const agg = rows(el, '.agg-table tbody tr');
    expect(agg[0].querySelector('.stale-chip')?.textContent).toContain('stale');
    expect(agg[0].classList.contains('row-stale')).toBe(true);
    expect(agg[1].querySelector('.stale-chip')).toBeNull();
  });

  it('renders the latest generatedAt as the analyzed stamp (PT-formatted)', async () => {
    const { el, fixture } = await setup();
    docsSubject.next([makeDoc({ generatedAt: '2026-11-05T00:00:00Z' })]);
    fixture.detectChanges();

    const stamp = el.querySelector('.analyzed-at')?.textContent ?? '';
    expect(stamp).toContain('Analyzed');
    expect(stamp).toContain('Nov 4'); // 2026-11-05T00:00Z → Nov 4 PT
    expect(stamp).not.toContain('T00:00:00Z'); // not raw ISO
  });

  it('failed result doc → banner names the exit + other rows still render', async () => {
    const { el, fixture } = await setup();
    docsSubject.next([
      makeDoc({ exitId: 'target-90' }),
      makeDoc({ exitId: 'dte-21', status: 'failed', error: 'series fetch failed' }),
    ]);
    fixture.detectChanges();

    const banner = el.querySelector('.failed-banner');
    expect(banner?.textContent).toContain('Exit at 21 DTE');
    expect(banner?.textContent).toContain('series fetch failed');

    const agg = rows(el, '.agg-table tbody tr');
    expect(agg[0].textContent).toContain('77.8'); // success row intact
    expect(agg.length).toBe(6);
  });

  it('renders event rows distinctly per outcome — exit, expired, error', async () => {
    const { el, fixture } = await setup();
    docsSubject.next([
      makeDoc({
        trades: [
          makeExitRecord(),
          makeExpiredRecord({ contractId: 'EXPIRED-C' }),
          makeErrorRecord({ contractId: 'ERR-C' }),
        ],
      }),
    ]);
    fixture.detectChanges();

    const text = el.querySelector('.event-table')!.textContent!;
    expect(text).toContain('2026-06-19'); // exit date
    expect(text).toContain('0.25'); // exit price
    expect(text).toContain('ITM');
    expect(text).toContain('0.84'); // assignment distance
    expect(text).toContain('no series');
    expect(el.querySelectorAll('.outcome-exit').length).toBe(1);
    expect(el.querySelectorAll('.outcome-expired').length).toBe(1);
    expect(el.querySelectorAll('.outcome-error').length).toBe(1);
    // MAE/MFE carry their dates (IMPL-FE: "MAE/MFE w/ dates").
    expect(text).toContain('2026-06-12');
    expect(text).toContain('2026-06-18');
  });

  it('error records render — for days/MAE/MFE (placeholders are not real data)', async () => {
    const { el, fixture } = await setup();
    docsSubject.next([makeDoc({ trades: [makeErrorRecord()] })]);
    fixture.detectChanges();

    const cells = rows(el, '.event-table tbody tr td');
    // Last three cells are days/MAE/MFE — placeholders must NOT render.
    for (const cell of cells.slice(-3)) {
      expect(cell.textContent).toContain('—');
      expect(cell.textContent).not.toContain('2.50');
    }
  });

  it('no route param → no service call and a state note instead of loading', async () => {
    const { el } = await setup(null);
    const service = TestBed.inject(OptionsAnalysisRunsService);
    expect(service.watchListResultDocs).not.toHaveBeenCalled();
    expect(el.querySelector('.state-note')?.textContent).toContain('No analysis list');
  });

  it('exit-type chips narrow the event rows', async () => {
    const { el, fixture } = await setup();
    docsSubject.next([
      makeDoc({ exitId: 'target-90', trades: [makeExitRecord({ contractId: 'T90' })] }),
      makeDoc({
        exitId: 'dte-21',
        trades: [makeExitRecord({ exitId: 'dte-21', contractId: 'DTE' })],
      }),
    ]);
    fixture.detectChanges();

    expect(rows(el, '.event-table tbody tr').length).toBe(2);

    const chips = rows(el, '.exit-filter .chip');
    const dteChip = chips.find((c) => c.textContent?.includes('Exit at 21 DTE'))!;
    dteChip.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    const filtered = rows(el, '.event-table tbody tr');
    expect(filtered.length).toBe(1);
    expect(filtered[0].textContent).toContain('DTE');
  });

  // #1431 — open outcome, outcome chips, mark change, capital/ROC, W/L,
  // header context, back nav, per-rule chart send.
  describe('1431 follow-ups', () => {
    it('bug 1 — open records render "still open" with real days/excursions, not error dashes', async () => {
      const { el, fixture } = await setup();
      docsSubject.next([makeDoc({ trades: [makeOpenRecord()] })]);
      fixture.detectChanges();

      const cells = rows(el, '.event-table tbody tr td');
      expect(cells[6].textContent).toContain('still open');
      expect(cells[6].textContent).toContain('2026-06-18');
      expect(cells[6].classList.contains('outcome-open')).toBe(true);
      // Mark change is '—' for open; days/MAE/MFE carry real values.
      expect(cells[10].textContent).toContain('—');
      expect(cells[12].textContent).toContain('9');
      expect(cells[13].textContent).toContain('1.20');
      expect(cells[14].textContent).toContain('3.10');
      expect(el.querySelector('.outcome-open')).not.toBeNull();
    });

    it('item 4+5 — headline carries template name, position count, and start date', async () => {
      const { el, fixture } = await setup();
      docsSubject.next([makeDoc()]);
      runSubject.next({
        runId: 'run-1_SPY',
        templateId: 'csp-45-20',
        symbol: 'SPY',
        startDate: '2026-01-05',
        status: 'completed',
        createdAtIso: '2026-01-05T00:00:00Z',
      });
      fixture.detectChanges();

      const headline = el.querySelector('.subject')!.textContent!;
      expect(headline).toContain('45DTE 20Δ put (CSP)');
      expect(headline).toContain('10 positions');
      expect(headline).toContain('from 2026-01-05');
    });

    it('item 6 — mark change column renders price change + % for exit rows; — for open', async () => {
      const { el, fixture } = await setup();
      docsSubject.next([
        makeDoc({
          trades: [
            makeExitRecord({ contractId: 'A', entryMark: 2.5, exitPrice: 0.25 }),
            makeOpenRecord({ contractId: 'B' }),
          ],
        }),
      ]);
      fixture.detectChanges();

      const trs = rows(el, '.event-table tbody tr');
      const exitRow = trs.find((r) => r.textContent!.includes('A ')) ??
        trs.find((r) => r.querySelectorAll('td')[1].textContent!.trim() === 'A')!;
      const deltaCell = exitRow.querySelectorAll('td')[10];
      expect(deltaCell.textContent).toContain('-2.25');
      expect(deltaCell.textContent).toContain('-90%');
    });

    it('QA — exit mark + entry/exit greeks columns render; absent fields → —', async () => {
      const { el, fixture } = await setup();
      docsSubject.next([
        makeDoc({
          trades: [
            makeExitRecord({
              contractId: 'G',
              entryDelta: -0.21,
              entryIv: 0.213,
              terminalMark: 0.25,
              terminalDelta: -0.05,
              terminalIv: 0.19,
            }),
            makeOpenRecord({ contractId: 'P' }), // pre-v2 shape — no greeks
          ],
        }),
      ]);
      fixture.detectChanges();

      const trs = rows(el, '.event-table tbody tr');
      const greekRow = trs.find((r) => r.querySelectorAll('td')[1].textContent!.trim() === 'G')!;
      const cells = greekRow.querySelectorAll('td');
      expect(cells[4].textContent).toContain('-0.210');
      expect(cells[5].textContent).toContain('21.3%');
      expect(cells[7].textContent).toContain('0.25');
      expect(cells[8].textContent).toContain('-0.050');
      expect(cells[9].textContent).toContain('19%');

      const sparseRow = trs.find((r) => r.querySelectorAll('td')[1].textContent!.trim() === 'P')!;
      const sparse = sparseRow.querySelectorAll('td');
      expect(sparse[4].textContent!.trim()).toBe('—');
      expect(sparse[5].textContent!.trim()).toBe('—');
      expect(sparse[7].textContent!.trim()).toBe('—');
      expect(sparse[8].textContent!.trim()).toBe('—');
      expect(sparse[9].textContent!.trim()).toBe('—');
    });

    it('item 7 — MAE cell carries % of premium subtext', async () => {
      const { el, fixture } = await setup();
      docsSubject.next([
        makeDoc({
          trades: [makeExitRecord({ entryMark: 2.0, mae: { value: 1.0, date: '2026-06-12' } })],
        }),
      ]);
      fixture.detectChanges();

      const maeCell = rows(el, '.event-table tbody tr td')[13];
      expect(maeCell.textContent).toContain('1.00');
      expect(maeCell.textContent).toContain('50%');
    });

    it('item 8 — W/L column renders wins/losses for a success doc', async () => {
      const { el, fixture } = await setup();
      docsSubject.next([
        makeDoc({
          exitId: 'target-90',
          trades: [
            makeExitRecord({ exitPrice: 0.25 }), // SHORT win (2.5 → 0.25)
            makeExitRecord({ exitPrice: 5.0, contractId: 'L' }), // SHORT loss
          ],
        }),
      ]);
      fixture.detectChanges();

      const wlCell = rows(el, '.agg-table tbody tr')[0].querySelectorAll('td')[4];
      expect(wlCell.textContent).toContain('1');
      expect(wlCell.querySelector('.wl-w')?.textContent).toContain('1');
      expect(wlCell.querySelector('.wl-l')?.textContent).toContain('1');
    });

    it('item 9 — outcome chips narrow the event table', async () => {
      const { el, fixture } = await setup();
      docsSubject.next([
        makeDoc({
          exitId: 'target-90',
          trades: [
            makeExitRecord({ contractId: 'A' }),
            makeOpenRecord({ contractId: 'B' }),
            makeErrorRecord({ contractId: 'C' }),
          ],
        }),
      ]);
      fixture.detectChanges();

      const chips = rows(el, '.outcome-filter .chip');
      const openChip = chips.find((c) => c.textContent?.trim() === 'Open')!;
      openChip.dispatchEvent(new Event('click'));
      fixture.detectChanges();

      const filtered = rows(el, '.event-table tbody tr');
      expect(filtered.length).toBe(1);
      expect(filtered[0].textContent).toContain('still open');
    });

    it('item 10 — capital/ROC column renders strike×100 + premium/strike', async () => {
      const { el, fixture } = await setup();
      // SPY260619P00500000 → strike 500 → capital 50,000; entry 2.5 → 0.50% ROC.
      docsSubject.next([makeDoc({ trades: [makeExitRecord()] })]);
      fixture.detectChanges();

      const capCell = rows(el, '.event-table tbody tr td')[11];
      expect(capCell.textContent).toContain('$50,000');
      expect(capCell.textContent).toContain('0.5% ROC');
    });

    it('item 11 — back link points at /options/strategy/backtest', async () => {
      const { el, fixture } = await setup();
      docsSubject.next([makeDoc()]);
      fixture.detectChanges();

      const back = el.querySelector('a.back-link')!;
      expect(back.getAttribute('href')).toBe('/options/strategy/backtest');
    });

    it('item 12 — success aggregate rows carry a chart link with the result-doc query param', async () => {
      const { el, fixture } = await setup();
      docsSubject.next([makeDoc({ exitId: 'target-90' })]);
      fixture.detectChanges();

      const link = el.querySelector('.agg-table tbody tr a.chart-link')!;
      const href = link.getAttribute('href')!;
      expect(href).toContain('/options/chart');
      expect(href).toContain('results=run-1_SPY_target-90');
      // Missing/failed rows don't get a chart link.
      const links = el.querySelectorAll('.agg-table tbody tr a.chart-link');
      expect(links.length).toBe(1);
    });

    it('open count renders in the aggregate table', async () => {
      const { el, fixture } = await setup();
      docsSubject.next([makeDoc({ aggregate: makeAggregate({ openCount: 3 }) })]);
      fixture.detectChanges();

      const tds = rows(el, '.agg-table tbody tr')[0].querySelectorAll('td');
      expect(tds[7].textContent!.trim()).toBe('3'); // Open column
    });
  });
});
