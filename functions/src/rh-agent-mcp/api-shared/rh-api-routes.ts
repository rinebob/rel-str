/**
 * Shared `/api/rh/**` route table + dispatch used by both the local
 * observation API (dev loopback server) and the cloud `rhApi` function.
 * Req/res are `http`-compatible under both `createServer` and `onRequest`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { isStringArray } from '@robinhood-mcp/utils';
import { getToolCategory, listObservationTools } from '../tools/robinhood-tools';
import {
  executeObservationTool,
  type ExecuteObservationToolOptions,
} from '../tools/robinhood-tool-executor';

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

interface JsonRequest {
  toolName?: string;
  args?: Record<string, unknown>;
  extraRedactFields?: string[];
}

/** Audit record per tool call — structural only, never args or payloads. */
export interface RhApiAuditEntry {
  tool: string;
  category?: string;
  outcome: 'success' | 'failure';
}

export interface RhApiRoutesOptions {
  executorOptions?: ExecuteObservationToolOptions;
  /** Mode-specific reauth handler — local runs interactive OAuth, cloud
   *  returns a structured REAUTHORIZATION_REQUIRED state. */
  reauthHandler: RhApiRouteHandler;
  /** Optional per-tool audit hook (cloud uses it for logger.info). */
  onAudit?: (entry: RhApiAuditEntry) => void;
}

type RhApiRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  match: RegExpMatchArray,
) => Promise<void>;

interface Route {
  method: 'GET' | 'POST';
  pattern: RegExp;
  handler: RhApiRouteHandler;
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    request.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalLength += buffer.length;
      if (totalLength > MAX_BODY_SIZE) {
        // Don't destroy the socket — the caller still needs to send the 413.
        reject(new Error('Request body exceeds maximum allowed size'));
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    request.on('error', reject);
  });
}

async function handleListTools(response: ServerResponse): Promise<void> {
  const tools = await listObservationTools();
  sendJson(response, 200, { success: true, tools });
}

async function handleExecuteTool(
  request: IncomingMessage,
  response: ServerResponse,
  toolNameFromPath: string,
  options: RhApiRoutesOptions,
): Promise<void> {
  // Under onRequest (Functions Framework / express) the body is already
  // parsed and the stream drained — reading it would hang forever. The
  // local http server never sets `body`, so it keeps the stream path.
  const preParsed = (request as IncomingMessage & { body?: unknown }).body;
  let parsed: JsonRequest;
  if (preParsed !== undefined) {
    if (typeof preParsed === 'object' && preParsed !== null && !Buffer.isBuffer(preParsed)) {
      parsed = preParsed as JsonRequest;
    } else {
      const raw = Buffer.isBuffer(preParsed) ? preParsed.toString('utf-8') : String(preParsed);
      try {
        parsed = JSON.parse(raw) as JsonRequest;
      } catch {
        sendJson(response, 400, { success: false, error: 'Invalid JSON body' });
        return;
      }
    }
  } else {
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
    try {
      parsed = JSON.parse(body) as JsonRequest;
    } catch {
      sendJson(response, 400, { success: false, error: 'Invalid JSON body' });
      return;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
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
    options.executorOptions,
  );

  options.onAudit?.({
    tool: toolNameFromPath,
    category: getToolCategory(toolNameFromPath),
    outcome: result.success ? 'success' : 'failure',
  });

  sendJson(response, 200, result);
}

function routeTable(options: RhApiRoutesOptions): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/rh\/tools$/,
      handler: async (_request, response) => handleListTools(response),
    },
    {
      method: 'POST',
      pattern: /^\/api\/rh\/auth\/reauth$/,
      handler: options.reauthHandler,
    },
    {
      method: 'POST',
      pattern: /^\/api\/rh\/tools\/([^/]+)$/,
      handler: async (request, response, match) =>
        handleExecuteTool(request, response, match[1]!, options),
    },
  ];
}

/**
 * Match `request` against the shared route table and run its handler,
 * emitting the `{ success: false, error }` envelope on 404/500.
 */
export async function dispatchRhApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: RhApiRoutesOptions,
): Promise<void> {
  const routes = routeTable(options);
  const url = new URL(
    request.url ?? '/',
    `http://${request.headers.host ?? 'localhost'}`,
  );
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
    console.error('RH API unhandled error:', error);
    sendJson(response, 500, {
      success: false,
      error: 'Internal server error',
    });
  }
}
