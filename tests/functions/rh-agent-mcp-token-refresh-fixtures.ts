import assert from "node:assert/strict";
import type {
  OAuthDiscoveryState,
  RobinhoodCredentialBundle,
  RobinhoodCredentialRepository,
} from "../../functions/src/rh-agent-mcp/index";

export const CURRENT_TIME = new Date("2026-07-18T19:00:00.000Z");

export const FULL_DISCOVERY_STATE: OAuthDiscoveryState = {
  authorizationServerUrl: "https://auth.synthetic.invalid",
  authorizationServerMetadata: {
    issuer: "https://auth.synthetic.invalid",
    authorization_endpoint: "https://auth.synthetic.invalid/authorize",
    token_endpoint: "https://auth.synthetic.invalid/token",
    jwks_uri: "https://auth.synthetic.invalid/jwks",
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  },
  resourceMetadata: {
    resource: "https://resource.synthetic.invalid/mcp",
    authorization_servers: ["https://auth.synthetic.invalid"],
  },
};

export const MINIMAL_DISCOVERY_STATE: OAuthDiscoveryState = {
  authorizationServerUrl: "https://auth.synthetic.invalid",
};

export class InMemoryCredentialRepository implements RobinhoodCredentialRepository {
  constructor(private credential: RobinhoodCredentialBundle | null) {}

  async load(): Promise<RobinhoodCredentialBundle | null> {
    return this.credential;
  }

  async store(
    credential: RobinhoodCredentialBundle,
    expectedRevision: number | null,
  ): Promise<RobinhoodCredentialBundle> {
    assert.equal(this.credential?.revision ?? null, expectedRevision);
    this.credential = {
      ...credential,
      revision: (this.credential?.revision ?? 0) + 1,
    };
    return this.credential;
  }

  async delete(): Promise<void> {
    this.credential = null;
  }

  current(): RobinhoodCredentialBundle | null {
    return this.credential;
  }
}

export function storedCredential(options: {
  accessToken: string;
  refreshToken?: string;
  lastTokenResponseAt: string;
  discoveryState?: OAuthDiscoveryState;
}): RobinhoodCredentialBundle {
  return {
    schemaVersion: 1,
    revision: 7,
    tokens: {
      access_token: options.accessToken,
      ...(options.refreshToken === undefined ? {} : { refresh_token: options.refreshToken }),
      expires_in: 3_600,
      token_type: "Bearer",
    },
    clientInformation: { client_id: "synthetic-client" },
    discoveryState: options.discoveryState ?? FULL_DISCOVERY_STATE,
    lastTokenResponseAt: options.lastTokenResponseAt,
  };
}

export function oauthResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
