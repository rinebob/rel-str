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
  executeObservationToolBatch,
  type ExecuteObservationToolOptions,
  type ObservationBatchCall,
} from '../tools/robinhood-tool-executor';

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const MAX_BATCH_CALLS = 20;

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
  // The local server's socket timeout destroys the response mid-request —
  // writing on it would throw ERR_STREAM_DESTROYED and crash the dev server.
  if (response.destroyed) return;
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
    // A stalled/aborted body must not leak a pending promise.
    request.on('close', () => reject(new Error('Request body stream closed before end')));
  });
}

async function handleListTools(response: ServerResponse): Promise<void> {
  const tools = await listObservationTools();
  sendJson(response, 200, { success: true, tools });
}

/** Reads (or reuses the framework-parsed) JSON body. Sends the 400/413
 *  itself and returns undefined on failure — callers check for undefined. */
async function parseJsonRequestBody(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<unknown> {
  // Under onRequest (Functions Framework / express) the body is already
  // parsed and the stream drained — reading it would hang forever. The
  // local http server never sets `body`, so it keeps the stream path.
  const preParsed = (request as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined) {
    if (typeof preParsed === 'object' && preParsed !== null && !Buffer.isBuffer(preParsed)) {
      return preParsed;
    }
    const raw = Buffer.isBuffer(preParsed) ? preParsed.toString('utf-8') : String(preParsed);
    try {
      return JSON.parse(raw);
    } catch {
      sendJson(response, 400, { success: false, error: 'Invalid JSON body' });
      return undefined;
    }
  }

  let body: string;
  try {
    body = await readBody(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('exceeds maximum allowed size')) {
      sendJson(response, 413, { success: false, error: 'Request body too large' });
      return undefined;
    }
    throw error;
  }
  try {
    return JSON.parse(body);
  } catch {
    sendJson(response, 400, { success: false, error: 'Invalid JSON body' });
    return undefined;
  }
}

async function handleExecuteTool(
  request: IncomingMessage,
  response: ServerResponse,
  toolNameFromPath: string,
  options: RhApiRoutesOptions,
): Promise<void> {
  const parsed = (await parseJsonRequestBody(request, response)) as JsonRequest | undefined;
  if (parsed === undefined) return;
  if (typeof parsed !== 'object' || parsed === null) {
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

interface BatchRequestBody {
  calls?: unknown;
}

/**
 * `POST /api/rh/batch` — `{ calls: [{ tool, args }] }`, cap 20. One MCP
 * session per batch request, sequential execution, ordered per-item
 * results carrying `tool` — a per-item failure never aborts the batch.
 * Session lifecycle and the batch deadline live in the executor; a
 * connect-level failure returns the single-call-style
 * `{ success: false }` envelope instead.
 */
async function handleExecuteBatch(
  request: IncomingMessage,
  response: ServerResponse,
  options: RhApiRoutesOptions,
): Promise<void> {
  const parsed = (await parseJsonRequestBody(request, response)) as BatchRequestBody | undefined;
  if (parsed === undefined) return;
  if (typeof parsed !== 'object' || parsed === null) {
    sendJson(response, 400, { success: false, error: 'Invalid JSON body' });
    return;
  }

  const calls = parsed.calls;
  if (!Array.isArray(calls) || calls.length === 0) {
    sendJson(response, 400, { success: false, error: 'calls must be a non-empty array' });
    return;
  }
  if (calls.length > MAX_BATCH_CALLS) {
    sendJson(response, 400, {
      success: false,
      error: `calls exceeds the maximum of ${MAX_BATCH_CALLS} per batch`,
    });
    return;
  }
  const malformed = calls.some(
    (c) =>
      typeof c !== 'object' ||
      c === null ||
      typeof (c as ObservationBatchCall).tool !== 'string' ||
      (c as ObservationBatchCall).tool.length === 0,
  );
  if (malformed) {
    sendJson(response, 400, {
      success: false,
      error: 'each call must be an object with a non-empty string tool',
    });
    return;
  }
  const items = calls as ObservationBatchCall[];

  const outcome = await executeObservationToolBatch(items, options.executorOptions);
  if (outcome.success) {
    for (const result of outcome.results) {
      options.onAudit?.({
        tool: result.tool,
        category: getToolCategory(result.tool),
        outcome: result.success ? 'success' : 'failure',
      });
    }
  } else {
    // Connect-level failure — every requested call failed; audit each.
    for (const call of items) {
      options.onAudit?.({
        tool: call.tool,
        category: getToolCategory(call.tool),
        outcome: 'failure',
      });
    }
  }
  sendJson(response, 200, outcome);
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
      pattern: /^\/api\/rh\/batch$/,
      handler: async (request, response) =>
        handleExecuteBatch(request, response, options),
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
