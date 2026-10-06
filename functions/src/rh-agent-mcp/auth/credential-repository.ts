import type { RobinhoodCredentialBundle } from '../contracts/authentication';

export interface RobinhoodCredentialRepository {
  load(): Promise<RobinhoodCredentialBundle | null>;
  store(
    credential: RobinhoodCredentialBundle,
    expectedRevision: number | null,
  ): Promise<RobinhoodCredentialBundle>;
  delete(): Promise<void>;
}

/** Symmetric cipher over a serialized credential bundle (DPAPI, KMS, test). */
export interface CredentialCipher {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

export class CredentialRevisionConflictError extends Error {
  override name = 'CredentialRevisionConflictError';
}

export class CredentialRepositoryBusyError extends Error {
  override name = 'CredentialRepositoryBusyError';
}

export class InvalidCredentialBundleError extends Error {
  override name = 'InvalidCredentialBundleError';
}

export class MalformedCredentialDocError extends Error {
  override name = 'MalformedCredentialDocError';
}
