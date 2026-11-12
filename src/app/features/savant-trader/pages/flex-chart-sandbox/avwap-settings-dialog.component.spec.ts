/// <reference types="jest" />
/**
 * Tests for AvwapSettingsDialogComponent — the AVWAP sandbox controls moved
 * out of the inline params strip (#1459). Rendered directly (not through the
 * overlay) with stub DS_DIALOG_DATA + DsDialogRef so the component's own
 * template wiring is the unit under test.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  AvwapSettingsDialogComponent,
  type AvwapSettingsDialogData,
} from './avwap-settings-dialog.component';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../shared/ds/ds-dialog';
import { ST_ANCHORED_VWAP_INDICATOR } from '../../../shared/components/flex-chart/indicators/indicator-registry';

describe('AvwapSettingsDialogComponent (#1459)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const PARAM_KEYS = [
    'line1RetracementPct', 'line2RetracementPct',
    'line1LeftDepth', 'line1RightDepth', 'line2LeftDepth', 'line2RightDepth',
    'line1HighColor', 'line1LowColor', 'line2HighColor', 'line2LowColor',
    'line1Weight', 'line2Weight', 'line1ZigZagColor', 'line2ZigZagColor',
    'showLine1High', 'showLine1Low', 'showLine2High', 'showLine2Low',
    'showLine1ZigZag', 'showLine2ZigZag', 'showLine1Confirms', 'showLine2Confirms',
    'line1Persist', 'line2Persist', 'maxHistory', 'historyStart',
  ];

  function buildData(
    overrides: Record<string, number | string | boolean> = {},
  ): AvwapSettingsDialogData & { onParam: jest.Mock; onClearHistory: jest.Mock } {
    const params = ST_ANCHORED_VWAP_INDICATOR.params;
    const values: Record<string, number | string | boolean> = {
      ...Object.fromEntries(params.map((p) => [p.key, p.default])),
      ...overrides,
    };
    return {
      params,
      historyParam: params.find((p) => p.key === 'historyStart')!,
      values: () => values,
      onParam: jest.fn(),
      onClearHistory: jest.fn(),
    };
  }

  async function setup(data = buildData()) {
    const ref = { close: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: DS_DIALOG_DATA, useValue: data },
        { provide: DsDialogRef, useValue: ref },
      ],
    });
    await TestBed.compileComponents();
    const fixture: ComponentFixture<AvwapSettingsDialogComponent> =
      TestBed.createComponent(AvwapSettingsDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, ref };
  }

  const q = (el: HTMLElement, testid: string) =>
    el.querySelector(`[data-testid="${testid}"]`);

  it('renders a control per editable AVWAP param — including the history row', async () => {
    const { el } = await setup();
    for (const key of PARAM_KEYS) {
      expect(q(el, `avwap-${key}`)).toBeTruthy();
    }
  });

  it('groups params into Line 1 / Line 2 / General with stripped labels and header Show toggles', async () => {
    const { el } = await setup();
    const titles = Array.from(el.querySelectorAll('.group-title')).map((n) => n.textContent!.trim());
    expect(titles).toEqual(['Line 1', 'Line 2', 'General']);

    // The 'Line N ' prefix is stripped inside each group — no repetition.
    const line1 = el.querySelector('[data-testid="avwap-group-Line1"]')!;
    const labels = Array.from(line1.querySelectorAll('.param-label')).map((n) => n.textContent!.trim());
    expect(labels).toEqual(['Retracement %', 'Weight', 'Left Depth', 'Right Depth', 'High Color', 'Low Color', 'ZigZag Color']);
    expect(labels.every((l) => !l.startsWith('Line 1'))).toBe(true);

    // Retracement + weight share the first row; depths pair, colors pair;
    // the leg color trails alone.
    const rows = Array.from(line1.querySelectorAll('.param-grid')).map((row) =>
      Array.from(row.querySelectorAll('.param-label')).map((n) => n.textContent!.trim()),
    );
    expect(rows).toEqual([
      ['Retracement %', 'Weight'],
      ['Left Depth', 'Right Depth'],
      ['High Color', 'Low Color'],
      ['ZigZag Color'],
    ]);

    // Per-line toggles sit on the group header — Upper/Lower/Legs/Confirms/Persist.
    const headToggles = Array.from(line1.querySelectorAll('.group-head .show-row')).map(
      (row) => row.textContent!.trim(),
    );
    expect(headToggles).toEqual(['Upper', 'Lower', 'Legs', 'Confirms', 'Persist']);
    expect(line1.querySelector('.group-head [data-testid="avwap-showLine1High"]')).toBeTruthy();
    expect(line1.querySelector('.group-head [data-testid="avwap-showLine1Low"]')).toBeTruthy();
    expect(line1.querySelector('.group-head [data-testid="avwap-showLine1ZigZag"]')).toBeTruthy();
    expect(line1.querySelector('.group-head [data-testid="avwap-showLine1Confirms"]')).toBeTruthy();
    expect(line1.querySelector('.group-head [data-testid="avwap-line1Persist"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="avwap-group-Line2"] .group-head [data-testid="avwap-showLine2High"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="avwap-group-Line2"] .group-head [data-testid="avwap-showLine2Low"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="avwap-group-Line2"] .group-head [data-testid="avwap-showLine2ZigZag"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="avwap-group-Line2"] .group-head [data-testid="avwap-showLine2Confirms"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="avwap-group-Line2"] .group-head [data-testid="avwap-line2Persist"]')).toBeTruthy();

    // Shared params land in General with their full labels.
    const general = el.querySelector('[data-testid="avwap-group-General"]')!;
    expect(general.querySelector('[data-testid="avwap-maxHistory"]')).toBeTruthy();
    expect(general.querySelector('[data-testid="avwap-historyStart"]')).toBeTruthy();
  });

  it('booleans render as checkboxes bound to the live values', async () => {
    const { el } = await setup();
    for (const key of ['showLine1High', 'showLine1Low', 'showLine1ZigZag']) {
      const box = q(el, `avwap-${key}`) as HTMLInputElement;
      expect(box.type).toBe('checkbox');
      expect(box.checked).toBe(true); // declared defaults
    }
    // The confirmation-point debug overlay and persist mode default off.
    const confirms = q(el, 'avwap-showLine1Confirms') as HTMLInputElement;
    expect(confirms.type).toBe('checkbox');
    expect(confirms.checked).toBe(false);
    const persist = q(el, 'avwap-line1Persist') as HTMLInputElement;
    expect(persist.type).toBe('checkbox');
    expect(persist.checked).toBe(false);
  });

  it('number/color params render as typed inputs with the current value', async () => {
    const { el } = await setup(buildData({ line1RetracementPct: 3.5 }));
    const num = q(el, 'avwap-line1RetracementPct') as HTMLInputElement;
    expect(num.type).toBe('number');
    expect(num.value).toBe('3.5');
    const color = q(el, 'avwap-line1HighColor') as HTMLInputElement;
    expect(color.type).toBe('color');
    expect(color.value.toUpperCase()).toBe('#FF8CFF');
  });

  it('control changes forward to onParam with the param def and the event', async () => {
    const data = buildData();
    const { el } = await setup(data);
    const input = q(el, 'avwap-line1RetracementPct') as HTMLInputElement;
    input.value = '4';
    input.dispatchEvent(new Event('change'));
    expect(data.onParam).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'line1RetracementPct' }),
      expect.any(Event),
    );

    const box = q(el, 'avwap-showLine1Low') as HTMLInputElement;
    box.dispatchEvent(new Event('change'));
    expect(data.onParam).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'showLine1Low' }),
      expect.any(Event),
    );
  });

  it('weight renders three radios per line, bound to the live value', async () => {
    const data = buildData({ line1Weight: 2 });
    const { el } = await setup(data);
    for (const key of ['line1Weight', 'line2Weight']) {
      const group = q(el, `avwap-${key}`)!;
      const radios = group.querySelectorAll('input[type="radio"]');
      expect(radios.length).toBe(3);
      expect(Array.from(radios).map((r) => (r as HTMLInputElement).value)).toEqual(['1', '2', '3']);
    }
    const r1 = q(el, 'avwap-line1Weight-2') as HTMLInputElement;
    expect(r1.checked).toBe(true);
    const r2d = q(el, 'avwap-line2Weight-1') as HTMLInputElement;
    expect(r2d.checked).toBe(true); // line2Weight default is 1 (line 1 is heaviest)

    r1.value = '1';
    r1.dispatchEvent(new Event('change'));
    expect(data.onParam).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'line1Weight' }),
      expect.any(Event),
    );
  });

  it('weight radios are not nested inside a label — a label-in-label pins clicks to the first radio', async () => {
    const { el } = await setup();
    const group = q(el, 'avwap-line1Weight')!;
    let node: Element | null = group;
    while (node && node !== el) {
      expect(node.tagName).not.toBe('LABEL');
      node = node.parentElement;
    }
  });

  it('the history clear button calls onClearHistory, not onParam', async () => {
    const data = buildData({ historyStart: '2025-06-15' });
    const { el } = await setup(data);
    const date = q(el, 'avwap-historyStart') as HTMLInputElement;
    expect(date.value).toBe('2025-06-15');

    q(el, 'avwap-history-clear')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(data.onClearHistory).toHaveBeenCalled();
    expect(data.onParam).not.toHaveBeenCalled();
  });

  it('Done closes the dialog', async () => {
    const { fixture, ref } = await setup();
    const btn = (fixture.nativeElement as HTMLElement).querySelector('.actions .ds-btn') as HTMLButtonElement;
    btn.click();
    expect(ref.close).toHaveBeenCalled();
  });
});
