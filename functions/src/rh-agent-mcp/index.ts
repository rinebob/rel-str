export { classifyAuthenticationError } from './auth/authentication-error-classifier';
export type {
  AuthenticationErrorCategory,
  ClassifiedAuthenticationError,
} from './auth/authentication-error-classifier';
export { runLocalOAuthBootstrap } from './auth/local-oauth-bootstrap';
export {
  McpSessionNotConnectedError,
  RobinhoodMcpSession,
} from './client/robinhood-mcp-session';
export type { RobinhoodMcpTransportFactory } from './client/robinhood-mcp-session';
export type {
  CredentialCipher,
  RobinhoodCredentialRepository,
} from './auth/credential-repository';
export {
  CredentialRepositoryBusyError,
  CredentialRevisionConflictError,
  InvalidCredentialBundleError,
  MalformedCredentialDocError,
} from './auth/credential-repository';
export { describeBundle, parseBundle } from './auth/credential-bundle-codec';
export {
  createKmsCipherFromEnv,
  KmsCipher,
  KmsOperationError,
  KmsUnavailableError,
} from './auth/kms-cipher';
export type { KmsCryptoOperations } from './auth/kms-cipher';
export {
  FirestoreDocStore,
  KmsFirestoreCredentialRepository,
  RH_CREDENTIAL_DOC_PATH,
  TransactionalCredentialDocumentBackend,
} from './auth/kms-firestore-credential-repository';
export type {
  CredentialDocSnapshot,
  CredentialDocStore,
  CredentialDocTransaction,
  CredentialDocumentBackend,
  StoredCredentialDoc,
} from './auth/kms-firestore-credential-repository';
export type {
  AuthenticationState,
  OAuthClientInformationMixed,
  OAuthDiscoveryState,
  OAuthTokens,
  RobinhoodCredentialBundle,
} from './contracts/authentication';
