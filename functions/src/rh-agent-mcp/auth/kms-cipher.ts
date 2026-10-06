/**
 * Cloud KMS-backed CredentialCipher. The key is never exportable — encrypt and
 * decrypt are IAM-authorized API calls executed inside the KMS vault, so the
 * ciphertext doc in Firestore is unreadable without the cryptoKey IAM grant.
 *
 * See docs/topics/657-rh-mcp/657-798-DESIGN-rh-mcp-cloud-credentials-kms-primer.md
 */
import { KeyManagementServiceClient } from '@google-cloud/kms';
import type { CredentialCipher } from './credential-repository';

interface KmsEncryptResponse {
  ciphertext?: Uint8Array | string | null;
}

interface KmsDecryptResponse {
  plaintext?: Uint8Array | string | null;
}

/**
 * Structural subset of KeyManagementServiceClient — the full client satisfies
 * this without casts, and tests can fake it with plain objects.
 */
export interface KmsCryptoOperations {
  encrypt(request: {
    name: string;
    plaintext: Uint8Array;
  }): Promise<[KmsEncryptResponse, ...unknown[]]>;
  decrypt(request: {
    name: string;
    ciphertext: Uint8Array;
  }): Promise<[KmsDecryptResponse, ...unknown[]]>;
}

export class KmsUnavailableError extends Error {
  override name = 'KmsUnavailableError';
}

export class KmsOperationError extends Error {
  override name = 'KmsOperationError';
}

function toBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? Buffer.from(value, 'base64') : value;
}

export class KmsCipher implements CredentialCipher {
  constructor(
    private readonly crypto: KmsCryptoOperations,
    private readonly keyName: string,
  ) {
    if (!keyName) {
      throw new KmsUnavailableError('KMS key name is empty');
    }
  }

  async encrypt(plaintext: string): Promise<string> {
    const [response] = await this.crypto.encrypt({
      name: this.keyName,
      plaintext: Buffer.from(plaintext, 'utf8'),
    });
    if (!response.ciphertext) {
      throw new KmsOperationError('KMS encrypt returned no ciphertext');
    }
    return Buffer.from(toBytes(response.ciphertext)).toString('base64');
  }

  async decrypt(ciphertext: string): Promise<string> {
    const [response] = await this.crypto.decrypt({
      name: this.keyName,
      ciphertext: Buffer.from(ciphertext, 'base64'),
    });
    if (!response.plaintext) {
      throw new KmsOperationError('KMS decrypt returned no plaintext');
    }
    return Buffer.from(toBytes(response.plaintext)).toString('utf8');
  }
}

/** Builds the production cipher — fails closed when the key name is unset. */
export function createKmsCipherFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): KmsCipher {
  const keyName = env.RH_CREDENTIAL_KEY_NAME;
  if (!keyName) {
    throw new KmsUnavailableError('RH_CREDENTIAL_KEY_NAME is not configured');
  }
  return new KmsCipher(new KeyManagementServiceClient(), keyName);
}
