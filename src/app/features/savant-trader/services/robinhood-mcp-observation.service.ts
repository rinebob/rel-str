import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  type RobinhoodToolDefinition,
  type ToolExecutionRequest,
  type ToolExecutionResult,
} from '@robinhood-mcp/contracts';

@Injectable({ providedIn: 'root' })
export class RobinhoodMcpObservationService {
  private readonly baseUrl = '/api/rh';

  constructor(private readonly http: HttpClient) {}

  async listTools(): Promise<RobinhoodToolDefinition[]> {
    const response = await firstValueFrom(
      this.http.get<{ success: boolean; tools: RobinhoodToolDefinition[] }>(
        `${this.baseUrl}/tools`,
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
      ),
    );
  }
}
