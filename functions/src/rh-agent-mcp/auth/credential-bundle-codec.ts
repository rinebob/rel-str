/**
 * Serialized-bundle validation shared by every credential repository
 * implementation (file, KMS+Firestore, portable). Decrypted plaintext that
 * doesn't conform to schemaVersion 1 is rejected, never silently repaired.
 */
import {
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  OAuthTokensSchema,
  type OAuthClientInformationMixed,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { RobinhoodCredentialBundle } from '../contracts/authentication';
import { InvalidCredentialBundleError } from './credential-repository';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBundle(serialized: string): RobinhoodCredentialBundle {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new InvalidCredentialBundleError();
  }

  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 1
  ) {
    throw new InvalidCredentialBundleError();
  }

  const lastTokenResponseAt = value.lastTokenResponseAt ?? value.lastSuccessfulRefreshAt;
  if (
    lastTokenResponseAt !== undefined &&
    (typeof lastTokenResponseAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(lastTokenResponseAt) ||
      !Number.isFinite(Date.parse(lastTokenResponseAt)))
  ) {
    throw new InvalidCredentialBundleError();
  }

  const tokens = OAuthTokensSchema.safeParse(value.tokens);
  if (!tokens.success) {
    throw new InvalidCredentialBundleError();
  }

  const clientInformation = parseClientInformation(value.clientInformation);
  const discoveryState = parseDiscoveryState(value.discoveryState);
  return {
    schemaVersion: 1,
    revision: value.revision,
    tokens: tokens.data,
    ...(clientInformation === undefined ? {} : { clientInformation }),
    ...(discoveryState === undefined ? {} : { discoveryState }),
    ...(lastTokenResponseAt === undefined
      ? {}
      : { lastTokenResponseAt }),
  };
}

/**
 * Structural projection of a bundle for logging/evidence — booleans and
 * metadata only, never token material. The single canonical redacted shape
 * for diagnostics and upload evidence.
 */
export function describeBundle(bundle: RobinhoodCredentialBundle) {
  return {
    schemaVersion: bundle.schemaVersion,
    revision: bundle.revision,
    tokenType: bundle.tokens.token_type,
    expiresIn: bundle.tokens.expires_in,
    scope: bundle.tokens.scope,
    hasAccessToken: Boolean(bundle.tokens.access_token),
    hasRefreshToken: Boolean(bundle.tokens.refresh_token),
    hasClientInformation: Boolean(bundle.clientInformation),
    hasDiscoveryState: Boolean(bundle.discoveryState),
    lastTokenResponseAt: bundle.lastTokenResponseAt,
  };
}

function parseClientInformation(value: unknown): OAuthClientInformationMixed | undefined {
  if (value === undefined) {
    return undefined;
  }
  const full = OAuthClientInformationFullSchema.safeParse(value);
  if (full.success) {
    return full.data;
  }
  const publicClient = OAuthClientInformationSchema.safeParse(value);
  if (publicClient.success) {
    return publicClient.data;
  }
  throw new InvalidCredentialBundleError();
}

function parseDiscoveryState(value: unknown): OAuthDiscoveryState | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || typeof value.authorizationServerUrl !== 'string') {
    throw new InvalidCredentialBundleError();
  }

  const authorizationServerMetadata = value.authorizationServerMetadata === undefined
    ? undefined
    : OAuthMetadataSchema.safeParse(value.authorizationServerMetadata);
  const resourceMetadata = value.resourceMetadata === undefined
    ? undefined
    : OAuthProtectedResourceMetadataSchema.safeParse(value.resourceMetadata);
  if (
    (authorizationServerMetadata !== undefined && !authorizationServerMetadata.success) ||
    (resourceMetadata !== undefined && !resourceMetadata.success)
  ) {
    throw new InvalidCredentialBundleError();
  }

  return {
    authorizationServerUrl: value.authorizationServerUrl,
    ...(authorizationServerMetadata === undefined
      ? {}
      : { authorizationServerMetadata: authorizationServerMetadata.data }),
    ...(resourceMetadata === undefined
      ? {}
      : { resourceMetadata: resourceMetadata.data }),
  };
}
