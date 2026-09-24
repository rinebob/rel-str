import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input } from '@angular/core';
import { By } from '@angular/platform-browser';

import { QuickChartsPanelComponent } from './quick-charts-panel.component';
import { QuickChartsComponent } from '../quick-charts/quick-charts.component';

@Component({
  selector: 'app-quick-charts',
  standalone: true,
})
class MockQuickChartsComponent {
  symbol = input<string | null>(null);
  logScale = input<boolean>(true);
}

describe('QuickChartsPanelComponent', () => {
  let fixture: ComponentFixture<QuickChartsPanelComponent>;

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [QuickChartsPanelComponent],
    })
      .overrideComponent(QuickChartsPanelComponent, {
        remove: { imports: [QuickChartsComponent] },
        add: { imports: [MockQuickChartsComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QuickChartsPanelComponent);
    fixture.componentRef.setInput('symbol', 'AAPL');
    fixture.detectChanges();
  }

  it('defaults logScale to true and passes it to the charts', async () => {
    await setup();
    const chart = fixture.debugElement.query(By.directive(MockQuickChartsComponent)).componentInstance;
    expect(chart.logScale()).toBe(true);
  });

  it('toggles the page-level pill and updates every chart input', async () => {
    await setup();
    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.qcp-log-pill')!;
    expect(btn.textContent).toContain('Yes');

    btn.click();
    fixture.detectChanges();

    const chart = fixture.debugElement.query(By.directive(MockQuickChartsComponent)).componentInstance;
    expect(chart.logScale()).toBe(false);
    expect(btn.textContent).toContain('No');
  });

  it('shows the log pill even when the symbol profile is missing', async () => {
    await setup();
    fixture.componentRef.setInput('profile', null);
    fixture.detectChanges();

    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.qcp-log-pill');
    expect(btn).toBeTruthy();
  });
});
