import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

const LOOPBACK_HOST = '127.0.0.1';
const CALLBACK_PATH = '/callback';
const MAX_REQUEST_URL_LENGTH = 4_096;

export interface LocalOAuthCallback {
  takeAuthorizationCode(): string;
}

export interface LocalOAuthCallbackServer {
  redirectUrl: string;
  callback: Promise<LocalOAuthCallback>;
  close(): Promise<void>;
}

export interface LocalOAuthCallbackServerOptions {
  expectedState: string;
  port: number;
  timeoutMs: number;
}

export class OAuthCallbackTimeoutError extends Error {
  override name = 'OAuthCallbackTimeoutError';
}

export class OAuthCallbackAuthorizationError extends Error {
  override name = 'OAuthCallbackAuthorizationError';
}

export class OAuthCallbackClosedError extends Error {
  override name = 'OAuthCallbackClosedError';
}

export class OAuthCallbackShutdownError extends Error {
  override name = 'OAuthCallbackShutdownError';
}

export class OAuthCallbackCodeConsumedError extends Error {
  override name = 'OAuthCallbackCodeConsumedError';
}

function statesMatch(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(error => error ? reject(error) : resolve());
  });
}

export async function startLocalOAuthCallbackServer({
  expectedState: initialExpectedState,
  port,
  timeoutMs,
}: LocalOAuthCallbackServerOptions): Promise<LocalOAuthCallbackServer> {
  let resolveCallback!: (callback: LocalOAuthCallback) => void;
  let rejectCallback!: (error: Error) => void;
  let claimed = false;
  let expectedState = initialExpectedState;
  let timeout: NodeJS.Timeout | undefined;
  let settlement: Promise<void> | undefined;
  const callback = new Promise<LocalOAuthCallback>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Method not allowed.');
      return;
    }

    const requestUrl = request.url ?? '';
    if (requestUrl.length > MAX_REQUEST_URL_LENGTH) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Invalid authorization callback.');
      return;
    }

    let url: URL;
    try {
      url = new URL(requestUrl, `http://${LOOPBACK_HOST}`);
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Invalid authorization callback.');
      return;
    }

    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found.');
      return;
    }

    if (claimed) {
      response.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Authorization callback is no longer active.');
      return;
    }

    const state = url.searchParams.get('state');
    if (!state || !statesMatch(state, expectedState)) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Invalid authorization callback.');
      return;
    }

    const authorizationError = url.searchParams.get('error');
    if (authorizationError) {
      claimed = true;
      expectedState = '';
      response.once('finish', () => {
        void settle({ error: new OAuthCallbackAuthorizationError() });
      });
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Authorization was not completed.');
      return;
    }

    const authorizationCode = url.searchParams.get('code');
    if (!authorizationCode) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Invalid authorization callback.');
      return;
    }

    claimed = true;
    expectedState = '';
    response.once('finish', () => {
      let availableCode: string | undefined = authorizationCode;
      void settle({
        callback: {
          takeAuthorizationCode: () => {
            if (!availableCode) {
              throw new OAuthCallbackCodeConsumedError();
            }
            const code = availableCode;
            availableCode = undefined;
            return code;
          },
        },
      });
    });
    response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end('Authorization received. Return to the terminal for the connection result, then close this tab.');
  });

  type Settlement =
    | { callback: LocalOAuthCallback }
    | { error: Error };

  function settle(result: Settlement): Promise<void> {
    if (settlement) {
      return settlement;
    }
    claimed = true;
    expectedState = '';
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    settlement = (async () => {
      try {
        await closeServer(server);
      } catch {
        rejectCallback(new OAuthCallbackShutdownError());
        return;
      }
      if ('callback' in result) {
        resolveCallback(result.callback);
      } else {
        rejectCallback(result.error);
      }
    })();
    return settlement;
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK_HOST, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Loopback callback address unavailable');
  }

  timeout = setTimeout(() => {
    void settle({ error: new OAuthCallbackTimeoutError() });
  }, timeoutMs);
  timeout.unref();

  return {
    redirectUrl: `http://${LOOPBACK_HOST}:${address.port}${CALLBACK_PATH}`,
    callback,
    close: async () => {
      await settle({ error: new OAuthCallbackClosedError() });
    },
  };
}
