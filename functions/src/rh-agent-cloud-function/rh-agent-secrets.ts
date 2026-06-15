/**
 * RH Agent Secrets
 *
 * Firebase Secrets configuration for API keys and OAuth tokens.
 * Secrets are stored in Firebase Secret Manager and injected at runtime.
 */
import { defineSecret } from 'firebase-functions/params';

/**
 * Anthropic API key for Claude agent
 * Set via: firebase functions:secrets:set ANTHROPIC_API_KEY
 */
export const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

/**
 * All secrets required by the rh-agent function.
 * Use this array in the secrets option of onSchedule/onCall.
 */
export const rhAgentSecrets = [
  anthropicApiKey,
];

/**
 * Get secrets from the runtime environment.
 * Call this inside the function handler to access secret values.
 */
export function getRhAgentSecrets() {
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  };
}

/**
 * Validate that required secrets are present.
 */
export function validateSecrets(): { valid: boolean; missing: string[] } {
  const secrets = getRhAgentSecrets();
  const missing: string[] = [];

  if (!secrets.anthropicApiKey) missing.push('ANTHROPIC_API_KEY');
  // Robinhood token is optional for dry-run mode

  return {
    valid: missing.length === 0,
    missing,
  };
}
