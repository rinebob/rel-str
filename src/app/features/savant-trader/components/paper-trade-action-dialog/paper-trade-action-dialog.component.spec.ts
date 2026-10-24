/**
 * PaperTradeActionDialogComponent spec (#671) — the confirm surface for
 * close/cancel on the paper-trading dashboard. Store + MatDialogRef are
 * stubbed at the boundary; the dialog renders the trade summary, calls
 * the matching store action on confirm, spins while `actingIds` holds
 * the trade, and closes with `true` when the action settles.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import {
  PaperTradeActionDialogComponent,
  type PaperTradeActionDialogData,
} from './paper-trade-action-dialog.component';
import { PaperTradingStore } from '../../stores/paper-trading.store';
import { TradeSide } from '@common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
} from '@paper-trading/contracts';

const TRADE: PaperTrade = {
  id: 'pt-1',
  kind: PaperTradingKind.TRADE,
  status: PaperTradeStatus.OPEN,
  source: PaperTradeSource.SIGNAL,
  symbol: 'AAPL',
  expression: 'EQ',
  governingVariant: 'trailing-8',
  order: { side: TradeSide.LONG, type: 'MARKET', quantity: 10 },
  fills: [],
  legs: [],
  marks: {
    '2026-10-20': { mark: 180.5 },
    '2026-10-22': { mark: 187.25 },
  },
  variantRuns: [],
  variantKeys: ['trailing-8'],
  realizedPnl: 0,
  unrealizedPnl: 42.5,
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-22T00:00:00Z',
} as PaperTrade;

describe('PaperTradeActionDialogComponent (#671)', () => {
  let fixture: ComponentFixture<PaperTradeActionDialogComponent>;
  let component: PaperTradeActionDialogComponent;
  let actingIds: ReturnType<typeof signal<ReadonlySet<string>>>;
  let storeMock: { actingIds: typeof actingIds; closeTrade: jest.Mock; cancelTrade: jest.Mock };
  let dialogRef: { close: jest.Mock };

  async function render(action: 'close' | 'cancel', trade: PaperTrade = TRADE): Promise<void> {
    const data: PaperTradeActionDialogData = { trade, action };
    await TestBed.resetTestingModule()
      .configureTestingModule({
        imports: [PaperTradeActionDialogComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideNoopAnimations(),
          { provide: PaperTradingStore, useValue: storeMock },
          { provide: MatDialogRef, useValue: dialogRef },
          { provide: MAT_DIALOG_DATA, useValue: data },
        ],
      })
      .compileComponents();
    fixture = TestBed.createComponent(PaperTradeActionDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    TestBed.tick();
  }

  beforeEach(() => {
    actingIds = signal<ReadonlySet<string>>(new Set());
    storeMock = { actingIds, closeTrade: jest.fn(), cancelTrade: jest.fn() };
    dialogRef = { close: jest.fn() };
  });

  it('renders the trade summary — id, symbol, expression, qty, variant, latest mark', async () => {
    await render('close');
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('pt-1');
    expect(text).toContain('AAPL');
    expect(text).toContain('EQ');
    expect(text).toContain('10');
    expect(text).toContain('trailing-8');
    expect(text).toContain('187.25'); // latest dated mark wins, not 180.5
    expect(text).not.toContain('180.50');
  });

  it('confirm on a close dialog calls store.closeTrade; a cancel dialog calls store.cancelTrade', async () => {
    await render('close');
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLElement>('[data-testid="confirm-action"]')!.click();
    expect(storeMock.closeTrade).toHaveBeenCalledWith('pt-1');
    expect(storeMock.cancelTrade).not.toHaveBeenCalled();

    await render('cancel', { ...TRADE, id: 'pt-2', status: PaperTradeStatus.PENDING });
    const el2 = fixture.nativeElement as HTMLElement;
    el2.querySelector<HTMLElement>('[data-testid="confirm-action"]')!.click();
    expect(storeMock.cancelTrade).toHaveBeenCalledWith('pt-2');
    expect(storeMock.closeTrade).toHaveBeenCalledTimes(1); // only the earlier close call
  });

  it('shows the spinner and disables confirm while the trade is acting', async () => {
    actingIds.set(new Set(['pt-1']));
    await render('close');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('mat-spinner')).toBeTruthy();
    expect(
      el.querySelector<HTMLButtonElement>('[data-testid="confirm-action"]')!.disabled,
    ).toBe(true);
  });

  it('closes once the acting flag settles after confirm — success or failure alike', async () => {
    storeMock.closeTrade.mockImplementation(() => actingIds.set(new Set(['pt-1'])));
    await render('close');
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLElement>('[data-testid="confirm-action"]')!.click();
    TestBed.tick();
    expect(dialogRef.close).not.toHaveBeenCalled(); // still in flight

    actingIds.set(new Set()); // failure already surfaced via the store's snackbar
    TestBed.tick();
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('a flag clearing WITHOUT a confirm does not close — pins the confirmed gate', async () => {
    actingIds.set(new Set(['pt-1']));
    await render('close'); // opened while the trade is already acting
    actingIds.set(new Set());
    TestBed.tick();
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(storeMock.closeTrade).not.toHaveBeenCalled();
  });

  it('the cancel/dismiss button closes without acting', async () => {
    await render('close');
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLElement>('[data-testid="dismiss"]')!.click();
    expect(dialogRef.close).toHaveBeenCalled();
    expect(storeMock.closeTrade).not.toHaveBeenCalled();
  });

  it('renders no mark row when the trade has no marks', async () => {
    await render('close', { ...TRADE, marks: {} });
    expect(fixture.nativeElement.querySelector('[data-testid="latest-mark"]')).toBeNull();
  });
});
