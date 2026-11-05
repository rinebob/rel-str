import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { BacktestAnalysisResultsComponent } from './backtest-analysis-results.component';

describe('BacktestAnalysisResultsComponent', () => {
  async function setup(listDocId: string | null = 'run-1_SPY') {
    const paramMap = new Map(listDocId === null ? [] : [['listDocId', listDocId]]);
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ActivatedRoute, useValue: { paramMap: of(paramMap) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(BacktestAnalysisResultsComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  it('exposes the listDocId route param and renders it', async () => {
    const { fixture, component } = await setup();
    expect(component.listDocId()).toBe('run-1_SPY');
    expect(fixture.nativeElement.textContent).toContain('run-1_SPY');
  });

  it('falls back to empty when the param is absent', async () => {
    const { component } = await setup(null);
    expect(component.listDocId()).toBe('');
  });
});
