/**
 * GalleryHeaderComponent spec (#754/#819) — the header's chart-interval
 * toggle is the page-level D/W switch for every card chart (decoupled from
 * the signal-timeframe pills), plus the refresh button (#misc).
 */
import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';

import { GalleryHeaderComponent } from './gallery-header.component';
import { GroupDimension, SignalTimeframe } from '../../common/constants';
import { SignalFilterPillsComponent } from '../signal-filter-pills/signal-filter-pills.component';
import { RhSelectMenuComponent } from '../rh-select-menu/rh-select-menu.component';

@Component({ selector: 'app-signal-filter-pills', standalone: true, template: '' })
class SignalFilterPillsStub {
  timeframe = input();
  direction = input();
  timeframeChange = output();
  directionChange = output();
}

@Component({ selector: 'app-rh-select-menu', standalone: true, template: '' })
class RhSelectMenuStub {
  label = input();
  options = input();
  optionGroups = input();
  value = input();
  valueChange = output();
}

describe('GalleryHeaderComponent', () => {
  let fixture: ComponentFixture<GalleryHeaderComponent>;

  const chartButtons = (): NodeListOf<HTMLButtonElement> =>
    fixture.nativeElement.querySelectorAll('.gh-chart-pills button');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GalleryHeaderComponent],
      providers: [provideNoopAnimations()],
    })
      .overrideComponent(GalleryHeaderComponent, {
        remove: { imports: [SignalFilterPillsComponent, RhSelectMenuComponent] },
        add: { imports: [SignalFilterPillsStub, RhSelectMenuStub] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(GalleryHeaderComponent);
    fixture.componentRef.setInput('groupDimension', GroupDimension.SECTOR);
    fixture.detectChanges();
  });

  it('marks the active chart interval on the D/W pills', () => {
    expect(chartButtons()[0].classList.contains('active')).toBe(true); // D default
    expect(chartButtons()[1].classList.contains('active')).toBe(false);

    fixture.componentRef.setInput('chartTimeframe', SignalTimeframe.WEEKLY);
    fixture.detectChanges();
    expect(chartButtons()[0].classList.contains('active')).toBe(false);
    expect(chartButtons()[1].classList.contains('active')).toBe(true);
  });

  it('emits chartTimeframeChange on D and W clicks — including the active pill', () => {
    const emitted: unknown[] = [];
    fixture.componentInstance.chartTimeframeChange.subscribe((v) => emitted.push(v));

    chartButtons()[1].click(); // W
    chartButtons()[1].click(); // W again — same-value click still emits
    chartButtons()[0].click(); // D

    expect(emitted).toEqual([
      SignalTimeframe.WEEKLY,
      SignalTimeframe.WEEKLY,
      SignalTimeframe.DAILY,
    ]);
  });

  it('renders the market date and run-completion timestamp', () => {
    fixture.componentRef.setInput('marketDate', '2026-10-03');
    fixture.componentRef.setInput('runCompletedAt', '2026-10-04T04:47:00.000Z');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('2026-10-03');
    expect(text).toContain('PT');
  });

  it('offers the None flat-mode option in the Group dropdown (#820)', () => {
    expect(
      fixture.componentInstance.dimensionOptions.map((o) => o.value),
    ).toContain(GroupDimension.NONE);
  });

  it('emits refresh and disables the button while refreshing', () => {
    let count = 0;
    fixture.componentInstance.refresh.subscribe(() => count++);

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button[matTooltip^="Refresh"]');
    btn.click();
    expect(count).toBe(1);

    fixture.componentRef.setInput('refreshing', true);
    fixture.detectChanges();
    expect(btn.disabled).toBe(true);
  });
});
