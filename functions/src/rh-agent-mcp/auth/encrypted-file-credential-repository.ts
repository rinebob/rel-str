import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  CredentialCipher,
  RefreshLeasePort,
  RobinhoodCredentialRepository,
} from './credential-repository';
import {
  CredentialRepositoryBusyError,
  CredentialRevisionConflictError,
} from './credential-repository';
import { createFileRefreshLease } from './file-refresh-lease';
import { parseBundle } from './credential-bundle-codec';
import type { RobinhoodCredentialBundle } from '../contracts/authentication';

const STALE_LOCK_AGE_MS = 5 * 60 * 1_000;

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export class EncryptedFileCredentialRepository implements RobinhoodCredentialRepository {
  private readonly lockPath: string;
  /** Serializes the refresh POST across local processes (issue #1658) —
   *  distinct from the store() lock so refresh can hold it across a write. */
  readonly refreshLease: RefreshLeasePort;

  constructor(
    private readonly filePath: string,
    private readonly cipher: CredentialCipher,
  ) {
    this.lockPath = `${filePath}.lock`;
    this.refreshLease = createFileRefreshLease(
      `${filePath}.refresh.lock`,
      async () => (await this.load())?.revision ?? null,
    );
  }

  async load(): Promise<RobinhoodCredentialBundle | null> {
    try {
      const ciphertext = await readFile(this.filePath, 'utf8');
      return parseBundle(await this.cipher.decrypt(ciphertext));
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return null;
      }
      throw error;
    }
  }

  async store(
    credential: RobinhoodCredentialBundle,
    expectedRevision: number | null,
  ): Promise<RobinhoodCredentialBundle> {
    await this.acquireLock();
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      const current = await this.load();
      if ((current?.revision ?? null) !== expectedRevision) {
        throw new CredentialRevisionConflictError();
      }
      const stored: RobinhoodCredentialBundle = {
        ...credential,
        schemaVersion: 1,
        revision: (current?.revision ?? 0) + 1,
      };
      const ciphertext = await this.cipher.encrypt(JSON.stringify(stored));
      await writeFile(temporaryPath, ciphertext, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.filePath);
      return stored;
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      await this.releaseLock();
    }
  }

  async delete(expectedRevision?: number): Promise<void> {
    await this.acquireLock();
    try {
      if (expectedRevision !== undefined) {
        const current = await this.load();
        if ((current?.revision ?? null) !== expectedRevision) {
          throw new CredentialRevisionConflictError();
        }
      }
      await rm(this.filePath, { force: true });
    } finally {
      await this.releaseLock();
    }
  }

  private async acquireLock(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await mkdir(this.lockPath);
      return;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }
    }

    const lock = await stat(this.lockPath).catch(() => undefined);
    if (!lock || Date.now() - lock.mtimeMs <= STALE_LOCK_AGE_MS) {
      throw new CredentialRepositoryBusyError();
    }

    const staleLockPath = `${this.lockPath}.${randomUUID()}.stale`;
    try {
      await rename(this.lockPath, staleLockPath);
      await rm(staleLockPath, { recursive: true, force: true });
      await mkdir(this.lockPath);
    } catch {
      await rm(staleLockPath, { recursive: true, force: true }).catch(() => undefined);
      throw new CredentialRepositoryBusyError();
    }
  }

  private async releaseLock(): Promise<void> {
    await rm(this.lockPath, { recursive: true, force: true });
  }
}
