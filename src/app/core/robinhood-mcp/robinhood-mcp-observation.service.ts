import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Auth, getIdToken } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { HTTP_TIMEOUT_TOKEN } from '../common/http-timeout.token';
import {
  type RobinhoodToolDefinition,
  type ToolExecutionRequest,
  type ToolExecutionResult,
} from '@robinhood-mcp/contracts';

/** Default timeout for MCP tool calls (30 seconds). */
const MCP_TOOL_TIMEOUT_MS = 30_000;

/** Timeout for read-only queries (reconcile, list tools). */
const MCP_READ_TIMEOUT_MS = 15_000;

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
