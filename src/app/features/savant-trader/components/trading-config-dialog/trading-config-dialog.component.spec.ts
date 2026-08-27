import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { TradingConfigDialogComponent } from './trading-config-dialog.component';
import { TradingConfigService } from '../../services/trading-config.service';

describe('TradingConfigDialogComponent', () => {
  let fixture: ComponentFixture<TradingConfigDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TradingConfigDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TradingConfigService, useValue: { getAccounts: jasmine.createSpy('getAccounts').and.returnValue(Promise.resolve([
          { accountNumber: 'agentic-account', accountType: 'cash', agenticAllowed: true },
        ])) } },
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
        { provide: MAT_DIALOG_DATA, useValue: null },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TradingConfigDialogComponent);
  });

  it('loads the agentic accounts and exposes the configured fields', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.form.accountNumber).toBe('agentic-account');
    expect(component.form.defaultDollarAmount).toBe(100);
    expect(component.form.maxUnits).toBe(200);
    expect(component.form.maxAllocationPercent).toBe(80);
  });
});
