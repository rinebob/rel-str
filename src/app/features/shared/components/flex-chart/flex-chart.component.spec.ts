import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FlexChartComponent } from './flex-chart.component';

describe('FlexChartComponent logScale default', () => {
  let fixture: ComponentFixture<FlexChartComponent>;
  let component: FlexChartComponent;
  let originalResizeObserver: unknown;

  beforeAll(() => {
    originalResizeObserver = (globalThis as Record<string, unknown>).ResizeObserver;
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe = jest.fn();
      disconnect = jest.fn();
      unobserve = jest.fn();
    };
  });

  afterAll(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = originalResizeObserver;
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlexChartComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FlexChartComponent);
    component = fixture.componentRef.instance;
  });

  it('defaults logScale to true when the parent omits it', () => {
    fixture.componentRef.setInput('chartData', null);
    fixture.componentRef.setInput('config', { indicators: [] });
    expect(component.effectiveConfig().logScale).toBe(true);
    // Observable effect: log mode hides generated gridlines via the strategy.
    expect(component.primaryYAxis().majorGridLines?.width).toBe(0);
  });

  it('respects logScale: false when the parent supplies it', () => {
    fixture.componentRef.setInput('chartData', null);
    fixture.componentRef.setInput('config', { indicators: [], logScale: false });
    expect(component.effectiveConfig().logScale).toBe(false);
    expect(component.primaryYAxis().majorGridLines?.width).not.toBe(0);
  });

  it('defaults logScale to true when the parent passes undefined', () => {
    fixture.componentRef.setInput('chartData', null);
    fixture.componentRef.setInput('config', { indicators: [], logScale: undefined });
    expect(component.effectiveConfig().logScale).toBe(true);
  });
});
