/// <reference types="jest" />
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { SymbolListActionsComponent } from './symbol-list-actions.component';
import type { SymbolListDef } from '../../common/symbol-list-defs';

function listDef(
  key: string,
  label: string,
  role: SymbolListDef['role'],
  order: number,
  symbols: string[] = [],
): SymbolListDef {
  return { key, label, order, role, hidden: false, symbols };
}

describe('SymbolListActionsComponent', () => {
  let fixture: ComponentFixture<SymbolListActionsComponent>;
  let component: SymbolListActionsComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SymbolListActionsComponent],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(SymbolListActionsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('symbol', 'aapl');
    fixture.componentRef.setInput('listCatalog', [
      listDef('PRIMARY', 'Primary', 'exclusive', 0, ['AAPL']),
      listDef('MONITOR', 'Monitor', 'nonexclusive', 5),
      listDef('my-picks', 'My Picks', 'nonexclusive', 100),
    ]);
    fixture.detectChanges();
  });

  it('renders system catalog lists only and reflects role-based membership', () => {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.map((button) => button.textContent.trim())).toEqual(['star', 'history']);
    expect(buttons[0].classList).toContain('active');
    expect(buttons[0].classList).toContain('primary');
    expect(buttons[1].classList).toContain('monitor');
    expect(buttons[1].classList).not.toContain('active');
  });

  it('emits the selected built-in list key through the common toggle output', () => {
    const events: { symbol: string; listKey: string }[] = [];
    component.toggleList.subscribe((event) => events.push(event));
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    buttons[1].click();

    expect(events).toEqual([{ symbol: 'aapl', listKey: 'MONITOR' }]);
  });
});
