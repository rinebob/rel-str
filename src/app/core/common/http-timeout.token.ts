import { HttpContextToken } from '@angular/common/http';

/**
 * Per-request HTTP timeout in milliseconds. When set via HttpContext,
 * the timeout interceptor will cancel the request if no response arrives
 * within the specified duration. Prevents indefinite hangs when calling
 * external services (e.g. Robinhood MCP) that may not respond.
 */
export const HTTP_TIMEOUT_TOKEN = new HttpContextToken<number | null>(() => null);
