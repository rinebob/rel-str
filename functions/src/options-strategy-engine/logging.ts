/**
 *
 * Minimal structured logger for the options strategy engine.
 *
 * This is intentionally a thin wrapper around `console` so the engine has a
 * single logging seam. Replace with a real logging backend (e.g. structured
 * Cloud Logging) when the project introduces one.
 */

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(label: string): Logger {
  return {
    info: (message: string) => console.info(`[${label}] ${message}`),
    warn: (message: string) => console.warn(`[${label}] ${message}`),
    error: (message: string) => console.error(`[${label}] ${message}`),
  };
}
