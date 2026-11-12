/// <reference types="jest" />
/**
 * DOM-level spec for the #1423 panel consolidation — mounts the real
 * template (children stubbed) and exercises the header drawer toggle →
 * `[class.open]` path that no-render specs can't reach.
 */
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { OptionChartComponent } from './option-chart.component';
import { OptionsContractChartComponent } from '../../components/options-contract-chart/options-contract-chart.component';
import { OptionGroupGeneratorComponent } from '../../components/option-group-generator/option-group-generator.component';
import { OptionsContractService } from '../../services/options-contract.service';
import { ContractAvailabilityService } from '../../services/contract-availability.service';
import { ContractListService } from '../../services/contract-list.service';
import { OptionsReplayRunsService } from '../../backtest/services/options-replay-runs.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import { DsDialogService } from '../../../../shared/ds/ds-dialog';

@Component({ selector: 'app-options-contract-chart', standalone: true, template: '' })
class MockChart {
  @Input() plottedSeries: unknown;
  @Input() xLabels: unknown;
  @Input() underlyingBars: unknown;
  @Input() showUnderlying: unknown;
  @Input() showGreeks: unknown;
  @Input() showVolumeOI: unknown;
  @Input() highlightedContractId: unknown;
  @Input() brushArmed: unknown;
  @Input() brushCorpus: unknown;
  @Input() activeStudyRange: unknown;
  @Input() tooltipMode: unknown;
  @Output() seriesHovered = new EventEmitter<unknown>();
  @Output() studyRange = new EventEmitter<unknown>();
  @Output() brushArmedChange = new EventEmitter<boolean>();
}

@Component({ selector: 'app-option-group-generator', standalone: true, template: '' })
class MockGenerator {
  @Output() send = new EventEmitter<string[]>();
}

describe('OptionChartComponent — panel toggle (DOM, #1423)', () => {
  let fixture: ComponentFixture<OptionChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: OptionsContractService, useValue: {
          // Minimal resolved response — chips reach 'loaded' status so
          // hover/pin bindings exercise the real non-error path.
          getHistoricalOptionsContract$: jest.fn((sym: string, cid: string) =>
            of({
              ok: true,
              symbol: sym,
              contractID: cid,
              expiration: '2026-06-19',
              type: 'put',
              strike: '470.00',
              startDate: '2026-06-01',
              endDate: '2026-06-10',
              series: [{ date: '2026-06-01', mark: '1.23' }],
            }),
          ),
          getContractIndex$: jest.fn(() => of({ expirations: [], strikes: [] })),
          getContractCatalogSummary$: jest.fn(() => of(null)),
        } },
        { provide: ContractAvailabilityService, useValue: { queryContractAvailability$: jest.fn() } },
        { provide: ContractListService, useValue: { getList$: jest.fn(() => of(null)), recentLists$: jest.fn(() => of([])) } },
        { provide: OptionsReplayRunsService, useValue: { watchRuns: jest.fn(() => of([])), watchContractList: jest.fn(() => of(null)) } },
        { provide: LocalBarReadService, useValue: { getDailyBarsForRange$: jest.fn(() => of([])) } },
        { provide: DsDialogService, useValue: { open: jest.fn(), openDialogs: [], closeAll: jest.fn() } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigate: jest.fn() } },
      ],
    })
      .overrideComponent(OptionChartComponent, {
        remove: { imports: [OptionsContractChartComponent, OptionGroupGeneratorComponent] },
        add: { imports: [MockChart, MockGenerator] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(OptionChartComponent);
    await fixture.whenStable();
  });

  it('the header tune button opens and closes the drawer aside', async () => {
    const el: HTMLElement = fixture.nativeElement;
    const aside = () => el.querySelector('aside.generator-panel');
    const toggle = () => el.querySelector('.generator-toggle') as HTMLButtonElement;

    expect(toggle()).toBeTruthy();
    expect(aside()).toBeTruthy();
    expect(aside()!.classList.contains('open')).toBe(false);

    toggle().click();
    await fixture.whenStable();
    expect(aside()!.classList.contains('open')).toBe(true);

    toggle().click();
    await fixture.whenStable();
    expect(aside()!.classList.contains('open')).toBe(false);
  });

  it('drawer order: symbol → contract list → accordion → manual entry (#1423)', () => {
    const el: HTMLElement = fixture.nativeElement;
    const aside = el.querySelector('aside.generator-panel')!;
    const text = aside.innerHTML;
    const idx = (needle: string) => text.indexOf(needle);

    // Symbol first, then the list section, then both accordion panels,
    // then manual entry — the #1423 drawer order.
    expect(idx('symbol-label-row')).toBeGreaterThanOrEqual(0);
    expect(idx('symbol-label-row')).toBeLessThan(idx('list-section'));
    expect(idx('list-section')).toBeLessThan(idx('acc-head-catalog'));
    expect(idx('acc-head-catalog')).toBeLessThan(idx('acc-head-gen'));
    expect(idx('acc-head-gen')).toBeLessThan(idx('entry-section'));
  });

  it('page order: drawer LEFT, chart middle, chips column RIGHT (#1423)', async () => {
    const el: HTMLElement = fixture.nativeElement;
    const drawer = el.querySelector('aside.generator-panel')!;
    const chart = el.querySelector('.chart-content')!;
    const headerBar = el.querySelector('.contract-header-bar')!;

    // The controls drawer sits left of the chart and its toggle is the
    // leftmost element of the header bar.
    expect(headerBar.firstElementChild!.classList.contains('generator-toggle')).toBe(true);
    expect(drawer.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The chips column renders only while a set is plotted or a load
    // rejected tokens — load one.
    expect(el.querySelector('aside.chips-panel')).toBeNull();
    await fixture.componentInstance.store.loadPlotted([
      { contractId: 'QQQ260619P00470000', openDate: null },
    ]);
    await fixture.whenStable();

    const chips = el.querySelector('aside.chips-panel')!;
    expect(chips).toBeTruthy();
    expect(chart.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('rejected tokens surface in the chips panel even with nothing plotted (#1423 review)', async () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('aside.chips-panel')).toBeNull();

    // A load that rejects every token still mounts the panel so the
    // notice is visible while the drawer is closed.
    fixture.componentInstance.rejectedEntries.set([
      { raw: 'not-a-contract', reason: 'invalid-contract' },
    ]);
    await fixture.whenStable();

    const chips = el.querySelector('aside.chips-panel')!;
    expect(chips).toBeTruthy();
    expect(chips.querySelector('.rejection-notice')!.textContent).toContain('1 entry skipped');
  });

  it('chip column bindings: mouseenter lights the line, container mouseleave clears', async () => {
    const el: HTMLElement = fixture.nativeElement;
    const store = fixture.componentInstance.store;
    await store.loadPlotted([
      { contractId: 'QQQ260619P00470000', openDate: null },
      { contractId: 'QQQ260619C00480000', openDate: null },
    ]);
    await fixture.whenStable();

    // Real template bindings — the enter lives on the chip, the clear
    // lives on the column (no per-chip leave, so slides can't flash).
    el.querySelector('.plotted-chip .chip-main')!.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(store.hoveredContractId()).toBe('QQQ260619P00470000');

    el.querySelector('.plotted-chips')!.dispatchEvent(new MouseEvent('mouseleave'));
    await fixture.whenStable();
    expect(store.hoveredContractId()).toBeNull();
  });

  it('accordion heads collapse and re-expand their panels', async () => {
    const el: HTMLElement = fixture.nativeElement;
    const catalogPanel = el.querySelector('.ds-panel:has(#acc-head-catalog)')!;
    const catalogHead = el.querySelector('#acc-head-catalog') as HTMLButtonElement;
    const genPanel = el.querySelector('.ds-panel:has(#acc-head-gen)')!;
    const genHead = el.querySelector('#acc-head-gen') as HTMLButtonElement;

    // Both default closed (#1423) — the drawer opens as a slim strip.
    expect(catalogPanel.classList.contains('open')).toBe(false);
    expect(genPanel.classList.contains('open')).toBe(false);

    catalogHead.click();
    await fixture.whenStable();
    expect(catalogPanel.classList.contains('open')).toBe(true);
    expect(genPanel.classList.contains('open')).toBe(false);

    catalogHead.click();
    genHead.click();
    await fixture.whenStable();
    expect(catalogPanel.classList.contains('open')).toBe(false);
    expect(genPanel.classList.contains('open')).toBe(true);
  });
});
