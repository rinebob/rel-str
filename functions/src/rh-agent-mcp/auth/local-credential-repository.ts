import { join } from 'node:path';
import { DpapiCredentialCipher } from './dpapi-credential-cipher';
import { EncryptedFileCredentialRepository } from './encrypted-file-credential-repository';
import type { RobinhoodCredentialRepository } from './credential-repository';

export class LocalCredentialStoreUnavailableError extends Error {
  override name = 'LocalCredentialStoreUnavailableError';
}

export function createLocalCredentialRepository(): RobinhoodCredentialRepository {
  const localAppData = process.env.LOCALAPPDATA;
  if (process.platform !== 'win32' || !localAppData) {
    throw new LocalCredentialStoreUnavailableError();
  }
  return new EncryptedFileCredentialRepository(
    join(localAppData, 'rel-str', 'rh-agent-mcp', 'credentials.dpapi'),
    new DpapiCredentialCipher(),
  );
}
