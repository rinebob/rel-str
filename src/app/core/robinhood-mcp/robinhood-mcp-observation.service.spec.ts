import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Auth, getIdToken } from '@angular/fire/auth';

import { environment } from '../../../environments/environment';
import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';

jest.mock('@angular/fire/auth', () => ({
  ...jest.requireActual('@angular/fire/auth'),
  getIdToken: jest.fn(),
}));

/** Flush the microtask queue — the service awaits ID-token resolution before
 *  dispatching, so the request lands after a macrotask boundary. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('RobinhoodMcpObservationService', () => {
  let service: RobinhoodMcpObservationService;
  let http: HttpTestingController;

  const mockGetIdToken = getIdToken as jest.Mock;

  const setup = (auth: unknown) => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useValue: auth },
      ],
    });
    service = TestBed.inject(RobinhoodMcpObservationService);
    http = TestBed.inject(HttpTestingController);
  };

  afterEach(() => {
    http.verify();
    jest.clearAllMocks();
  });

  it('attaches the signed-in user ID token as a Bearer header', async () => {
    const user = { uid: 'owner-uid' };
    mockGetIdToken.mockResolvedValue('id-token-123');
    setup({ currentUser: user });

    const pending = service.executeTool('get_accounts', { args: {} });
    await flush();
    const req = http.expectOne(`${environment.rhApiBaseUrl}/tools/get_accounts`);

    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer id-token-123');
    expect(mockGetIdToken).toHaveBeenCalledWith(user);

    req.flush({ success: true });
    await pending;
  });

  it('sends requests unauthenticated when no user is signed in', async () => {
    setup({ currentUser: null });

    const pending = service.executeTool('get_accounts', {});
    await flush();
    const req = http.expectOne(`${environment.rhApiBaseUrl}/tools/get_accounts`);

    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(mockGetIdToken).not.toHaveBeenCalled();

    req.flush({ success: true });
    await pending;
  });

  it('dispatches no request when ID-token minting fails', async () => {
    mockGetIdToken.mockRejectedValue(new Error('auth/network-request-failed'));
    setup({ currentUser: { uid: 'owner-uid' } });

    await expect(service.executeTool('get_accounts', {})).rejects.toThrow('auth/network-request-failed');
    await flush();
    http.expectNone(`${environment.rhApiBaseUrl}/tools/get_accounts`);
  });

  it('attaches the token on GET calls too', async () => {
    mockGetIdToken.mockResolvedValue('id-token-get');
    setup({ currentUser: { uid: 'owner-uid' } });

    const pending = service.listTools();
    await flush();
    const req = http.expectOne(`${environment.rhApiBaseUrl}/tools`);

    expect(req.request.headers.get('Authorization')).toBe('Bearer id-token-get');
    req.flush({ success: true, tools: [] });
    await pending;
  });

  it('targets the environment-configured base URL for tool list', async () => {
    setup({ currentUser: null });

    const pending = service.listTools();
    await flush();
    const req = http.expectOne(`${environment.rhApiBaseUrl}/tools`);

    expect(req.request.method).toBe('GET');
    req.flush({ success: true, tools: [{ name: 'get_accounts' }] });
    await pending;
  });

  it('attaches the token to reauth calls', async () => {
    mockGetIdToken.mockResolvedValue('id-token-xyz');
    setup({ currentUser: { uid: 'owner-uid' } });

    const pending = service.reauthenticate();
    await flush();
    const req = http.expectOne(`${environment.rhApiBaseUrl}/auth/reauth`);

    expect(req.request.headers.get('Authorization')).toBe('Bearer id-token-xyz');
    req.flush({ success: false, state: 'REAUTHORIZATION_REQUIRED' });
    await pending;
  });
});
