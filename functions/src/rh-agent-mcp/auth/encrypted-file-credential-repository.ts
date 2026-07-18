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
import {
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  OAuthTokensSchema,
  type OAuthClientInformationMixed,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { RobinhoodCredentialRepository } from './credential-repository';
import type { RobinhoodCredentialBundle } from '../contracts/authentication';

const STALE_LOCK_AGE_MS = 5 * 60 * 1_000;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBundle(serialized: string): RobinhoodCredentialBundle {
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

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export class EncryptedFileCredentialRepository implements RobinhoodCredentialRepository {
  private readonly lockPath: string;

  constructor(
    private readonly filePath: string,
    private readonly cipher: CredentialCipher,
  ) {
    this.lockPath = `${filePath}.lock`;
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

  async delete(): Promise<void> {
    await this.acquireLock();
    try {
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
