import type { AuthenticationState } from '../contracts/authentication';

export type AuthenticationErrorCategory =
  | 'AUTHORIZATION_REJECTED'
  | 'USER_INTERACTION_REQUIRED'
  | 'OAUTH_CONFIGURATION_INVALID'
  | 'PROVIDER_TEMPORARILY_UNAVAILABLE'
  | 'UNKNOWN_AUTHENTICATION_FAILURE';

export interface ClassifiedAuthenticationError {
  state: AuthenticationState;
  category: AuthenticationErrorCategory;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('errorCode' in error)) {
    return undefined;
  }
  const value = error.errorCode;
  return typeof value === 'string' ? value : undefined;
}

function errorClassName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  return error.constructor?.name;
}

export function classifyAuthenticationError(error: unknown): ClassifiedAuthenticationError {
  const code = errorCode(error);

  if (code === 'invalid_grant' || code === 'access_denied' || code === 'invalid_token') {
    return {
      state: 'REAUTHORIZATION_REQUIRED',
      category: 'AUTHORIZATION_REJECTED',
    };
  }

  if (
    errorClassName(error) === 'UnauthorizedError' ||
    errorClassName(error) === 'OAuthCallbackAuthorizationError'
  ) {
    return {
      state: 'REAUTHORIZATION_REQUIRED',
      category: 'USER_INTERACTION_REQUIRED',
    };
  }

  if (
    code === 'invalid_client' ||
    code === 'invalid_client_metadata' ||
    code === 'invalid_request' ||
    code === 'invalid_target' ||
    code === 'unauthorized_client' ||
    code === 'unsupported_grant_type' ||
    code === 'unsupported_response_type'
  ) {
    return {
      state: 'MISCONFIGURED',
      category: 'OAUTH_CONFIGURATION_INVALID',
    };
  }

  if (
    code === 'server_error' ||
    code === 'temporarily_unavailable' ||
    code === 'too_many_requests'
  ) {
    return {
      state: 'TEMPORARILY_UNAVAILABLE',
      category: 'PROVIDER_TEMPORARILY_UNAVAILABLE',
    };
  }

  return {
    state: 'TEMPORARILY_UNAVAILABLE',
    category: 'UNKNOWN_AUTHENTICATION_FAILURE',
  };
}
