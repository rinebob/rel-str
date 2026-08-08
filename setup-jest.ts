import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv();

// Polyfill fetch for Node.js (needed by Firebase Auth module-level initialization)
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = (() => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') } as Response)) as typeof fetch;
}
