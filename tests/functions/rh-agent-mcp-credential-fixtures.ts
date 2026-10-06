/**
 * Shared fixtures for rh-agent-mcp credential tests: a synthetic (structurally
 * valid, valueless) credential bundle and a base64 test cipher whose output is
 * non-plaintext but dependency-free.
 */
import type { CredentialCipher } from "../../functions/src/rh-agent-mcp/auth/credential-repository";
import type { RobinhoodCredentialBundle } from "../../functions/src/rh-agent-mcp/index";

export const base64TestCipher: CredentialCipher = {
  encrypt: async (plaintext: string) => Buffer.from(plaintext, "utf8").toString("base64"),
  decrypt: async (ciphertext: string) => Buffer.from(ciphertext, "base64").toString("utf8"),
};

export function syntheticBundle(
  revision: number,
  accessToken: string,
): RobinhoodCredentialBundle {
  return {
    schemaVersion: 1,
    revision,
    tokens: {
      access_token: accessToken,
      refresh_token: "synthetic-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
    },
    clientInformation: { client_id: "synthetic-client-id" },
    discoveryState: { authorizationServerUrl: "https://synthetic.invalid" },
  };
}
