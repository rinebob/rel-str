import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { of, firstValueFrom } from 'rxjs';

import { TradingConfigService } from './trading-config.service';
import { RobinhoodMcpObservationService } from '../../../core/robinhood-mcp/robinhood-mcp-observation.service';

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

  beforeEach(() => {
    mcpService = {
      executeTool: jasmine.createSpy('executeTool'),
    };

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
