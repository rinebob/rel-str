/**
 * Upload flow for seeding the production credential doc
 * (`rh-agent-credentials/bundle`) — shared by `scripts/upload-rh-credential.ts`
 * and the task #806 live verify.
 *
 * Reads a portable bundle file produced by
 * `diagnostics/export-credential-bundle.ts`, stores it through a
 * RobinhoodCredentialRepository (seed: `store(bundle, null)`; replace: CAS on
 * the current revision after reauthorization), then re-loads through the same
 * repository to prove the round-trip.
 *
 * The returned evidence is structural only — token values never appear in it.
 */
import { readFile } from 'node:fs/promises';
import { describeBundle, parseBundle } from './credential-bundle-codec';
import type { RobinhoodCredentialRepository } from './credential-repository';
import type { RobinhoodCredentialBundle } from '../contracts/authentication';

export class UploadRoundTripError extends Error {
  override name = 'UploadRoundTripError';
}

/** Structural upload evidence — describeBundle + flow metadata, never token material. */
export type UploadEvidence = ReturnType<typeof describeBundle> & {
  mode: 'seed' | 'replace';
  reloadedEquivalent: true;
};

/** Names the first top-level field whose value differs, else null. */
function differingField(expected: object, actual: object): string | null {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    if (
      JSON.stringify(Reflect.get(expected, key)) !==
      JSON.stringify(Reflect.get(actual, key))
    ) {
      return key;
    }
  }
  return null;
}

/** Reads a portable bundle file — parseBundle validates and fails closed. */
export async function readBundleFile(
  path: string,
): Promise<RobinhoodCredentialBundle> {
  return parseBundle(await readFile(path, 'utf8'));
}

/**
 * Stores the bundle and re-loads it to prove the encrypted round-trip.
 * Seed mode relies on the repository's CAS guard to refuse overwriting an
 * existing doc (CredentialRevisionConflictError).
 */
export async function uploadCredentialBundle(
  repository: RobinhoodCredentialRepository,
  bundle: RobinhoodCredentialBundle,
  options: { replace?: boolean } = {},
): Promise<UploadEvidence> {
  const expectedRevision = options.replace
    ? (await repository.load())?.revision ?? null
    : null;
  const stored = await repository.store(bundle, expectedRevision);

  const reloaded = await repository.load();
  if (!reloaded) {
    throw new UploadRoundTripError('repository reload returned null after store');
  }
  const diff = differingField(stored, reloaded);
  if (diff) {
    throw new UploadRoundTripError(`reload mismatch on field: ${diff}`);
  }

  return {
    ...describeBundle(stored),
    mode: options.replace ? 'replace' : 'seed',
    reloadedEquivalent: true,
  };
}
