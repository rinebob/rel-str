import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { isStringArray } from '@robinhood-mcp/utils';
import { listObservationTools } from '../tools/robinhood-tools';
import {
  executeObservationTool,
  type ExecuteObservationToolOptions,
} from '../tools/robinhood-tool-executor';

const PORT = Number(process.env.RH_OBSERVATION_API_PORT ?? 3456);
const HOST = process.env.RH_OBSERVATION_API_HOST ?? '127.0.0.1';
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

interface JsonRequest {
  toolName?: string;
  args?: Record<string, unknown>;
  extraRedactFields?: string[];
}

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

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    request.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalLength += buffer.length;
      if (totalLength > MAX_BODY_SIZE) {
        reject(new Error('Request body exceeds maximum allowed size'));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function handleListTools(response: ServerResponse): Promise<void> {
  const tools = await listObservationTools();
  sendJson(response, 200, { success: true, tools });
}

async function handleExecuteTool(
  request: IncomingMessage,
  response: ServerResponse,
  toolNameFromPath: string,
  executorOptions?: ExecuteObservationToolOptions,
): Promise<void> {
  let body: string;
  try {
    body = await readBody(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('exceeds maximum allowed size')) {
      sendJson(response, 413, {
        success: false,
        error: 'Request body too large',
      });
      return;
    }
    throw error;
  }
  let parsed: JsonRequest;
  try {
    parsed = JSON.parse(body) as JsonRequest;
  } catch {
    sendJson(response, 400, { success: false, error: 'Invalid JSON body' });
    return;
  }

  if (parsed.toolName && parsed.toolName !== toolNameFromPath) {
    sendJson(response, 400, {
      success: false,
      error: 'toolName in body must match toolName in path',
    });
    return;
  }

  if (parsed.extraRedactFields !== undefined && !isStringArray(parsed.extraRedactFields)) {
    sendJson(response, 400, {
      success: false,
      error: 'extraRedactFields must be an array of strings',
    });
    return;
  }

  const result = await executeObservationTool(
    toolNameFromPath,
    parsed.args ?? {},
    { extraFields: parsed.extraRedactFields },
    executorOptions,
  );

  sendJson(response, 200, result);
}

interface Route {
  method: 'GET' | 'POST';
  pattern: RegExp;
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    match: RegExpMatchArray,
  ) => Promise<void>;
}

export function createRobinhoodObservationApi(
  executorOptions?: ExecuteObservationToolOptions,
) {
  const routes: Route[] = [
    {
      method: 'GET',
      pattern: /^\/api\/rh\/tools$/,
      handler: async (_request, response) => handleListTools(response),
    },
    {
      method: 'POST',
      pattern: /^\/api\/rh\/tools\/([^/]+)$/,
      handler: async (request, response, match) =>
        handleExecuteTool(request, response, match[1]!, executorOptions),
    },
  ];

  return createServer(async (request, response) => {
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

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? HOST}`);
    const route = routes.find(
      (r) => r.method === request.method && r.pattern.test(url.pathname),
    );

    if (!route) {
      sendJson(response, 404, { success: false, error: 'Not found' });
      return;
    }

    const match = route.pattern.exec(url.pathname);

    try {
      await route.handler(request, response, match!);
    } catch (error) {
      console.error('Observation API unhandled error:', error);
      sendJson(response, 500, {
        success: false,
        error: 'Internal server error',
      });
    }
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
