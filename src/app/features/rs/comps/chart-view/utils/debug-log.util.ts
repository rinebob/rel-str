/**
 * Utility for debug logging. Replace with a more robust logging service as needed.
 * All debug logs should go through this utility for consistency and easy removal in production.
 */
export function debugLog(label: string, data: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`[DEBUG] ${label}:`, data);
}
