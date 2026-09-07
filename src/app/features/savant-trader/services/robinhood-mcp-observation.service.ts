import { Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { HTTP_TIMEOUT_TOKEN } from '../../../core/common/http-timeout.token';
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
  private readonly baseUrl = '/api/rh';

  constructor(private readonly http: HttpClient) {}

  async listTools(): Promise<RobinhoodToolDefinition[]> {
    const response = await firstValueFrom(
      this.http.get<{ success: boolean; tools: RobinhoodToolDefinition[] }>(
        `${this.baseUrl}/tools`,
        { context: new HttpContext().set(HTTP_TIMEOUT_TOKEN, MCP_READ_TIMEOUT_MS) },
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
    return firstValueFrom(
      this.http.post<ToolExecutionResult>(
        `${this.baseUrl}/tools/${name}`,
        request,
        { context: new HttpContext().set(HTTP_TIMEOUT_TOKEN, MCP_TOOL_TIMEOUT_MS) },
      ),
    );
  }

  async reauthenticate(): Promise<{ success: boolean; state?: string; category?: string; error?: string }> {
    return firstValueFrom(
      this.http.post<{ success: boolean; state?: string; category?: string; error?: string }>(
        `${this.baseUrl}/auth/reauth`,
        {},
        { context: new HttpContext().set(HTTP_TIMEOUT_TOKEN, MCP_TOOL_TIMEOUT_MS) },
      ),
    );
  }
}
