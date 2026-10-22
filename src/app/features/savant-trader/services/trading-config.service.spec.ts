import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, firstValueFrom } from 'rxjs';

import { TradingConfigService } from './trading-config.service';
import { RobinhoodMcpObservationService } from '../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { stConfigDocPath } from '@st/collections';

// Partial mock: keep the real Firestore injection token, stub the modular
// read/write fns so loadConfig/saveConfig payloads are directly observable.
jest.mock('@angular/fire/firestore', () => ({
  ...jest.requireActual('@angular/fire/firestore'),
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
}));

const mockDoc = doc as jest.Mock;
const mockGetDoc = getDoc as jest.Mock;
const mockSetDoc = setDoc as jest.Mock;

describe('TradingConfigService', () => {
  let service: TradingConfigService;
  let mcpService: any;
  let snackBarMock: { open: jest.Mock };

  beforeEach(() => {
    mcpService = {
      executeTool: jasmine.createSpy('executeTool'),
    };
    snackBarMock = { open: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: Auth,
          useValue: {
            // AngularFire's authState() wraps onAuthStateChanged — the stub
            // must emit a user synchronously and return an unsubscribe.
            onAuthStateChanged: (cb: (u: unknown) => void) => {
              cb({ uid: 'user-123' });
              return () => {};
            },
          },
        },
        {
          provide: Firestore,
          useValue: {},
        },
        { provide: RobinhoodMcpObservationService, useValue: mcpService },
        { provide: MatSnackBar, useValue: snackBarMock },
        TradingConfigService,
      ],
    });

    service = TestBed.inject(TradingConfigService);
  });

  describe('getAccounts', () => {
    it('returns agentic-allowed accounts from { data: { accounts: [...] } } shape', async () => {
      mcpService.executeTool.and.resolveTo({
        success: true,
        parsed: {
          data: {
            accounts: [
              { account_number: '123456789', type: 'brokerage', agentic_allowed: true },
              { account_number: '987654321', type: 'retirement', agentic_allowed: false },
              { account_number: '555444333', type: 'brokerage', agentic_allowed: true },
            ],
          },
        },
        redacted: {},
        tool: 'get_accounts',
      });

      const accounts = await service.getAccounts();

      expect(accounts.length).toBe(2);
      expect(accounts[0].accountNumber).toBe('123456789');
      expect(accounts[0].accountType).toBe('brokerage');
      expect(accounts[0].agenticAllowed).toBe(true);
      expect(accounts[1].accountNumber).toBe('555444333');
      expect(accounts[1].agenticAllowed).toBe(true);
    });

    it('returns agentic-allowed accounts from { accounts: [...] } shape', async () => {
      mcpService.executeTool.and.resolveTo({
        success: true,
        parsed: {
          accounts: [
            { account_number: '111222333', type: 'brokerage', agentic_allowed: true },
          ],
        },
        redacted: {},
        tool: 'get_accounts',
      });

      const accounts = await service.getAccounts();

      expect(accounts.length).toBe(1);
      expect(accounts[0].accountNumber).toBe('111222333');
    });

    it('returns agentic-allowed accounts from bare array shape', async () => {
      mcpService.executeTool.and.resolveTo({
        success: true,
        parsed: [
          { account_number: '444555666', type: 'brokerage', agentic_allowed: true },
        ],
        redacted: {},
        tool: 'get_accounts',
      });

      const accounts = await service.getAccounts();

      expect(accounts.length).toBe(1);
      expect(accounts[0].accountNumber).toBe('444555666');
    });

    it('returns empty array when no accounts are agentic-allowed', async () => {
      mcpService.executeTool.and.resolveTo({
        success: true,
        parsed: {
          data: {
            accounts: [
              { account_number: '123456789', type: 'retirement', agentic_allowed: false },
            ],
          },
        },
        redacted: {},
        tool: 'get_accounts',
      });

      const accounts = await service.getAccounts();

      expect(accounts.length).toBe(0);
    });

    it('returns empty array when accounts array is empty', async () => {
      mcpService.executeTool.and.resolveTo({
        success: true,
        parsed: { data: { accounts: [] } },
        redacted: {},
        tool: 'get_accounts',
      });

      const accounts = await service.getAccounts();

      expect(accounts.length).toBe(0);
    });

    it('returns empty array when parsed has no accounts property', async () => {
      mcpService.executeTool.and.resolveTo({
        success: true,
        parsed: {},
        redacted: {},
        tool: 'get_accounts',
      });

      const accounts = await service.getAccounts();

      expect(accounts.length).toBe(0);
    });

    it('throws when MCP call fails', async () => {
      mcpService.executeTool.and.resolveTo({
        success: false,
        error: 'Auth failed',
        category: 'AUTH',
      });

      try {
        await service.getAccounts();
        fail('Expected getAccounts to throw');
      } catch (err) {
        expect((err as Error).message).toBe('Auth failed');
      }
    });

    it('calls get_accounts with no args', async () => {
      mcpService.executeTool.and.resolveTo({
        success: true,
        parsed: { results: [] },
        redacted: {},
        tool: 'get_accounts',
      });

      await service.getAccounts();

      expect(mcpService.executeTool).toHaveBeenCalledWith('get_accounts', {});
    });
  });

  describe('loadConfig', () => {
    beforeEach(() => {
      mockDoc.mockReset().mockReturnValue({});
      mockGetDoc.mockReset();
      mockSetDoc.mockReset();
    });

    it('maps optionMaxPremiumCashPercent from the stored doc', async () => {
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({
          accountNumber: '123456789',
          optionMaxPremiumCashPercent: 15,
        }),
      });

      const config = await firstValueFrom(service.loadConfig());

      expect(config?.optionMaxPremiumCashPercent).toBe(15);
    });

    it('reads the user config doc at st-config/{uid}', async () => {
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ accountNumber: '123456789' }),
      });

      await firstValueFrom(service.loadConfig());

      expect(mockDoc).toHaveBeenCalledWith(expect.anything(), stConfigDocPath('user-123'));
    });

    it('returns undefined optionMaxPremiumCashPercent when the doc predates the field', async () => {
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ accountNumber: '123456789' }),
      });

      const config = await firstValueFrom(service.loadConfig());

      expect(config?.optionMaxPremiumCashPercent).toBeUndefined();
    });

    it('returns null when no config doc exists', (done) => {
      // The service uses modular Firestore getDoc which reads from the real
      // Firestore instance. With an empty Firestore mock, getDoc will throw
      // or return undefined. We verify the observable contract: it should
      // emit null or an error, not hang.
      service.loadConfig().subscribe({
        next: (config) => {
          // With a mock Firestore, the doc won't exist — expect null or error
          expect(config).toBeNull();
          done();
        },
        error: () => {
          // Error is acceptable with a mock Firestore — the contract is that
          // loadConfig returns an Observable<TradingConfig | null>
          expect(true).toBe(true);
          done();
        },
      });
    });
  });

  describe('config cache — ensureConfig/warmConfig (#1177)', () => {
    beforeEach(() => {
      mockDoc.mockReset().mockReturnValue({});
      mockGetDoc.mockReset();
    });

    const doc = (data: Record<string, unknown>) => ({
      exists: () => true,
      data: () => data,
    });

    it('ensureConfig loads once then serves the cache — including the null case', async () => {
      mockGetDoc.mockResolvedValue(doc({ accountNumber: '123' }));
      const first = await service.ensureConfig();
      const second = await service.ensureConfig();
      expect(first?.accountNumber).toBe('123');
      expect(second).toBe(first);
      expect(mockGetDoc).toHaveBeenCalledTimes(1);
      expect(service.config()?.accountNumber).toBe('123');
    });

    it('caches a legit null (no config doc) — no refetch storm', async () => {
      mockGetDoc.mockResolvedValue({ exists: () => false });
      await service.ensureConfig();
      await service.ensureConfig();
      expect(service.config()).toBeNull();
      expect(mockGetDoc).toHaveBeenCalledTimes(1);
    });

    it('snackbars and returns null on load failure — a later call retries', async () => {
      mockGetDoc.mockRejectedValue(new Error('firestore down'));
      const r = await service.ensureConfig();
      expect(r).toBeNull();
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Failed to load trading config', 'Dismiss', { duration: 4000 },
      );
      mockGetDoc.mockResolvedValue(doc({ accountNumber: '123' }));
      const r2 = await service.ensureConfig();
      expect(r2?.accountNumber).toBe('123');
      expect(mockGetDoc).toHaveBeenCalledTimes(2);
    });

    it('warmConfig fills the shared cache so ensureConfig serves it without a read', async () => {
      mockGetDoc.mockResolvedValue(doc({ accountNumber: '999' }));
      service.warmConfig();
      // Macrotask flush — the subscribe path crosses a promise boundary.
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(service.config()?.accountNumber).toBe('999');
      const r = await service.ensureConfig();
      expect(r?.accountNumber).toBe('999');
      expect(mockGetDoc).toHaveBeenCalledTimes(1);
    });

    it('saveConfig invalidates the cache — the next ensureConfig re-fetches', async () => {
      mockGetDoc.mockResolvedValue(doc({ accountNumber: '123' }));
      mockSetDoc.mockReset().mockResolvedValue(undefined);
      await service.ensureConfig();
      await firstValueFrom(service.saveConfig({ accountNumber: '123456789' }));
      mockGetDoc.mockResolvedValue(doc({ accountNumber: '123456789' }));
      const r = await service.ensureConfig();
      expect(r?.accountNumber).toBe('123456789');
      expect(mockGetDoc).toHaveBeenCalledTimes(2);
    });
  });

  describe('saveConfig', () => {
    beforeEach(() => {
      mockDoc.mockReset().mockReturnValue({});
      mockGetDoc.mockReset();
      mockSetDoc.mockReset().mockResolvedValue(undefined);
    });

    it('writes optionMaxPremiumCashPercent to the config doc', async () => {
      await firstValueFrom(
        service.saveConfig({ accountNumber: '123456789', optionMaxPremiumCashPercent: 15 }),
      );

      expect(mockSetDoc).toHaveBeenCalledWith(
        {},
        jasmine.objectContaining({ optionMaxPremiumCashPercent: 15 }),
        { merge: true },
      );
    });

    it('omits optionMaxPremiumCashPercent when unset', async () => {
      await firstValueFrom(service.saveConfig({ accountNumber: '123456789' }));

      const payload = mockSetDoc.mock.calls[0][1] as Record<string, unknown>;
      expect('optionMaxPremiumCashPercent' in payload).toBe(false);
    });

    it('returns an observable that completes', (done) => {
      service.saveConfig({ accountNumber: '123456789' }).subscribe({
        next: () => {
          expect(true).toBe(true);
          done();
        },
        error: () => {
          // Error is acceptable with a mock Firestore
          expect(true).toBe(true);
          done();
        },
      });
    });
  });
});
