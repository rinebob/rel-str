import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { OrderConfirmDialogComponent } from './order-confirm-dialog.component';
import {
  EquityOrderTicket,
  OptionOrderTicket,
  InstrumentType,
  OrderSource,
  OrderTicketStatus,
  OrderTicket,
} from '../../services/order-ticket.types';

describe('OrderConfirmDialogComponent', () => {
  let dialogRef: { close: jest.Mock };

  function equityTicket(overrides: Partial<EquityOrderTicket> = {}): EquityOrderTicket {
    return {
      id: 'ticket-1',
      refId: 'ref-1',
      source: OrderSource.SIGNAL_PIPELINE,
      status: OrderTicketStatus.STAGED,
      accountNumber: '123456789',
      side: 'buy',
      orderType: 'limit',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      instrumentType: InstrumentType.EQUITY,
      symbol: 'AAPL',
      quantity: '10',
      limitPrice: '150.25',
      createdAt: '2026-08-25T12:00:00Z',
      updatedAt: '2026-08-25T12:00:00Z',
      ...overrides,
    };
  }

  function optionTicket(overrides: Partial<OptionOrderTicket> = {}): OptionOrderTicket {
    return {
      id: 'opt-1',
      refId: 'ref-opt-1',
      source: OrderSource.SIGNAL_PIPELINE,
      status: OrderTicketStatus.STAGED,
      accountNumber: '123456789',
      side: 'buy',
      orderType: 'limit',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      instrumentType: InstrumentType.OPTION,
      symbol: 'QQQ',
      legs: [
        { side: 'buy', symbol: 'QQQ  260320C00500000', optionId: 'opt-uuid-1', positionEffect: 'open' },
      ],
      quantity: '2',
      price: '3.50',
      createdAt: '2026-08-25T12:00:00Z',
      updatedAt: '2026-08-25T12:00:00Z',
      ...overrides,
    };
  }

  async function render(ticket: OrderTicket): Promise<HTMLElement> {
    dialogRef = { close: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [OrderConfirmDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { ticket } },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrderConfirmDialogComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the equity summary rows unchanged', async () => {
    const el = await render(equityTicket());
    const text = el.textContent ?? '';

    expect(text).toContain('AAPL');
    expect(text).toContain('BUY');
    expect(text).toContain('LIMIT');
    expect(text).toContain('10');
    expect(text).toContain('150.25');
    expect(text).toContain('GFD');
    expect(text).toContain('123456789');
    expect(text).not.toContain('Contract');
    expect(text).not.toContain('Premium');
  });

  it('renders the option contract summary: underlying, OCC, expiry·strike·call/put, BUY TO OPEN, premium', async () => {
    const el = await render(optionTicket());
    const text = el.textContent ?? '';

    expect(text).toContain('Underlying');
    expect(text).toContain('QQQ');
    expect(text).toContain('QQQ  260320C00500000');
    expect(text).toContain('2026-03-20');
    expect(text).toContain('500');
    expect(text).toContain('CALL');
    expect(text).toContain('BUY TO OPEN');
    expect(text).toContain('2 contracts');
    expect(text).toContain('LIMIT');
    expect(text).toContain('3.50');
    // Total premium = 2 contracts × $3.50 × 100 multiplier = $700.00
    expect(text).toContain('Premium');
    expect(text).toContain('700.00');
    expect(text).toContain('123456789');
  });

  it('hides the limit-price and premium rows on a market option order — the wire omits price', async () => {
    const el = await render(optionTicket({ orderType: 'market', price: '3.50' }));
    const text = el.textContent ?? '';

    expect(text).toContain('MARKET');
    expect(text).not.toContain('Limit Price');
    expect(text).not.toContain('Premium');
  });

  it('renders the pinned regular_hours for options even when the ticket field diverges', async () => {
    const el = await render(optionTicket({ marketHours: 'all_day_hours' as OptionOrderTicket['marketHours'] }));
    const text = el.textContent ?? '';

    expect(text).toContain('regular_hours');
    expect(text).not.toContain('all_day_hours');
  });

  it('still renders an option ticket whose OCC symbol fails to parse — no expiry row, no crash', async () => {
    const el = await render(
      optionTicket({ legs: [{ side: 'buy', symbol: 'NOT-AN-OCC', optionId: 'x', positionEffect: 'open' }] }),
    );
    const text = el.textContent ?? '';

    expect(text).toContain('NOT-AN-OCC');
    expect(text).toContain('BUY TO OPEN');
    expect(text).not.toContain('Expires');
  });
});
