import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Auth, getIdToken } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { HTTP_TIMEOUT_TOKEN } from '../common/http-timeout.token';
import {
  type RobinhoodToolDefinition,
  type ToolExecutionErrorCategory,
  type ToolExecutionRequest,
  type ToolExecutionResult,
} from '@robinhood-mcp/contracts';
import { RobinhoodMcpError } from './types/robinhood-mcp.types';

/**
 * Request timeout for MCP tool calls and batches. The server's worst case is
 * ~80s regardless of call count: session connect (≤30s) runs inside the 75s
 * batch budget, plus ~5s session close. A shorter client timeout aborts
 * slow-but-valid batches and turns recoverable per-item failures into false
 * transport errors on every section.
 */
const MCP_TOOL_TIMEOUT_MS = 90_000;

/** Timeout for read-only queries (reconcile, list tools). */
const MCP_READ_TIMEOUT_MS = 15_000;

/**
 * A single call inside a `POST /api/rh/batch` request — the API runs all
 * calls on one MCP session and returns one ToolExecutionResult per call,
 * in request order.
 */
export interface ToolBatchCall {
  tool: string;
  args?: Record<string, unknown>;
}

/** `POST /api/rh/batch` response — a successful batch carries one result per
 *  call; a session-level failure returns the error/category envelope with no
 *  `results`. */
interface BatchResponse {
  success: boolean;
  results?: ToolExecutionResult[];
  error?: string;
  category?: ToolExecutionErrorCategory;
}

@Injectable({ providedIn: 'root' })
export class RobinhoodMcpObservationService {
  private readonly auth = inject(Auth, { optional: true });
  private readonly baseUrl = environment.rhApiBaseUrl;

  constructor(private readonly http: HttpClient) {}

  async listTools(): Promise<RobinhoodToolDefinition[]> {
    const headers = await this.authHeaders();
    const response = await firstValueFrom(
      this.http.get<{ success: boolean; tools: RobinhoodToolDefinition[] }>(
        `${this.baseUrl}/tools`,
        {
          context: new HttpContext().set(HTTP_TIMEOUT_TOKEN, MCP_READ_TIMEOUT_MS),
          headers,
        },
      ),
    );
    if (!response.success || !Array.isArray(response.tools)) {
      throw new Error('Invalid tool list response from observation API');
    }
    return response.tools;
  }

  async executeTool(
    name: string,
    request: ToolExecutionRequest = {},
  ): Promise<ToolExecutionResult> {
    const headers = await this.authHeaders();
    return firstValueFrom(
      this.http.post<ToolExecutionResult>(
        `${this.baseUrl}/tools/${name}`,
        request,
        {
          context: new HttpContext().set(HTTP_TIMEOUT_TOKEN, MCP_TOOL_TIMEOUT_MS),
          headers,
        },
      ),
    );
  }

  /**
   * Runs several tool calls in one `POST /batch` request. Results come back
   * ordered 1:1 with `calls`; a failed call occupies its own slot as a
   * `success:false` ToolExecutionResult — it does not fail the batch. The
   * promise itself only rejects on transport/envelope failure (HTTP error,
   * session connect failure, malformed response), which callers should treat
   * as every call failed.
   */
  async executeTools(calls: readonly ToolBatchCall[]): Promise<ToolExecutionResult[]> {
    if (calls.length === 0) return [];
    const headers = await this.authHeaders();
    const response = await firstValueFrom(
      this.http.post<BatchResponse>(
        `${this.baseUrl}/batch`,
        { calls },
        {
          context: new HttpContext().set(HTTP_TIMEOUT_TOKEN, MCP_TOOL_TIMEOUT_MS),
          headers,
        },
      ),
    );
    if (!response.success && typeof response.error === 'string') {
      // Session-level failure envelope — surface the server's error/category
      // (e.g. AUTH on expired RH credentials) instead of a generic message.
      throw new RobinhoodMcpError(response.error, 'batch', response.category);
    }
    if (!response.success || !Array.isArray(response.results) || response.results.length !== calls.length) {
      throw new Error('Invalid batch response from observation API');
    }
    return response.results;
  }

  async reauthenticate(): Promise<{ success: boolean; state?: string; category?: string; error?: string; message?: string }> {
    const headers = await this.authHeaders();
    return firstValueFrom(
      this.http.post<{ success: boolean; state?: string; category?: string; error?: string; message?: string }>(
        `${this.baseUrl}/auth/reauth`,
        {},
        {
          context: new HttpContext().set(HTTP_TIMEOUT_TOKEN, MCP_TOOL_TIMEOUT_MS),
          headers,
        },
      ),
    );
  }

  /**
   * Attaches the current user's Firebase ID token as a Bearer header. rhApi
   * requires it; the local observation API ignores it — one code path, no env
   * branching. When no user is signed in the request goes out unauthenticated
   * and surfaces the API's 401 (routes are authGuard-protected; this is a
   * belt line, not the auth mechanism).
   */
  private async authHeaders(): Promise<Record<string, string>> {
    const user = this.auth?.currentUser;
    if (!user) return {};
    return { Authorization: `Bearer ${await getIdToken(user)}` };
  }
}
