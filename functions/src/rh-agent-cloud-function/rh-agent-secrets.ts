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
 * Robinhood OAuth access token
 * Set via: firebase functions:secrets:set ROBINHOOD_ACCESS_TOKEN
 */
export const robinhoodAccessToken = defineSecret('ROBINHOOD_ACCESS_TOKEN');

/**
 * Robinhood OAuth refresh token (TBD - speculative)
 * NOTE: Refresh token mechanism is unconfirmed. Robinhood OAuth details
 * need verification before implementing token refresh flow.
 * Set via: firebase functions:secrets:set ROBINHOOD_REFRESH_TOKEN
 */
// export const robinhoodRefreshToken = defineSecret('ROBINHOOD_REFRESH_TOKEN');

/**
 * All secrets required by the rh-agent function.
 * Use this array in the secrets option of onSchedule/onCall.
 */
export const rhAgentSecrets = [
  anthropicApiKey,
  robinhoodAccessToken,
  // robinhoodRefreshToken, // TBD - pending OAuth verification
];

/**
 * Get secrets from the runtime environment.
 * Call this inside the function handler to access secret values.
 */
export function getRhAgentSecrets() {
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    robinhoodAccessToken: process.env.ROBINHOOD_ACCESS_TOKEN || '',
    // robinhoodRefreshToken: process.env.ROBINHOOD_REFRESH_TOKEN || '', // TBD
  };
}

/**
 * Validate that required secrets are present.
 */
export function validateSecrets(): { valid: boolean; missing: string[] } {
  const secrets = getRhAgentSecrets();
  const missing: string[] = [];

  if (!secrets.anthropicApiKey) missing.push('ANTHROPIC_API_KEY');
  if (!secrets.robinhoodAccessToken) missing.push('ROBINHOOD_ACCESS_TOKEN');

  return {
    valid: missing.length === 0,
    missing,
  };
}
