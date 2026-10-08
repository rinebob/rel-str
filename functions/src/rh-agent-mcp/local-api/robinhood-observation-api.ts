import { createServer, type ServerResponse } from 'node:http';
import type { ExecuteObservationToolOptions } from '../tools/robinhood-tool-executor';
import { runLocalOAuthBootstrapWithDependencies } from '../auth/local-oauth-bootstrap';
import {
  dispatchRhApiRequest,
  sendJson,
} from '../api-shared/rh-api-routes';

const PORT = Number(process.env.RH_OBSERVATION_API_PORT ?? 3456);
const HOST = process.env.RH_OBSERVATION_API_HOST ?? '127.0.0.1';
const REQUEST_TIMEOUT_MS = 90_000; // must exceed the 75s batch budget + connect/auth margin

function isLocalhost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function isLoopback(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address === '0:0:0:0:0:0:0:1'
  );
}

function isNotLocalEnvironment(): boolean {
  if (!isLocalhost(HOST)) {
    return true;
  }
  if (process.env.NODE_ENV === 'production') {
    return true;
  }
  return false;
}

async function handleLocalReauth(response: ServerResponse): Promise<void> {
  try {
    const result = await runLocalOAuthBootstrapWithDependencies({ forceReauthorization: true });
    sendJson(response, 200, {
      success: result.state === 'CONNECTED',
      state: result.state,
      category: result.evidence.resultCategory,
      evidence: result.evidence,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, {
      success: false,
      error: message,
    });
  }
}

export function createRobinhoodObservationApi(
  executorOptions?: ExecuteObservationToolOptions,
) {
  return createServer(async (request, response) => {
    // Force-close the underlying socket if the handler doesn't respond in time.
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      if (!response.headersSent) {
        sendJson(response, 504, { success: false, error: 'Gateway timeout' });
      }
      response.destroy();
    });
    if (isNotLocalEnvironment()) {
      sendJson(response, 403, {
        success: false,
        error: 'Observation API is only available in local development.',
      });
      return;
    }

    const remoteAddress = request.socket.remoteAddress;
    if (!isLoopback(remoteAddress)) {
      sendJson(response, 403, {
        success: false,
        error: 'Observation API is only available from localhost.',
      });
      return;
    }

    await dispatchRhApiRequest(request, response, {
      executorOptions,
      reauthHandler: async (_request, res) => handleLocalReauth(res),
    });
  });
}

export async function startRobinhoodObservationApi(): Promise<void> {
  if (isNotLocalEnvironment()) {
    throw new Error(
      'Observation API refuses to start outside a local development environment.',
    );
  }

  const server = createRobinhoodObservationApi();
  return new Promise((resolve, reject) => {
    server.listen(PORT, HOST, () => {
      console.log(`Robinhood observation API listening on http://${HOST}:${PORT}`);
      resolve();
    });
    server.on('error', reject);
  });
}
