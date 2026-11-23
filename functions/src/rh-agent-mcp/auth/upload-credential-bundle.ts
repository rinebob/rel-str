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
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describeBundle, parseBundle } from './credential-bundle-codec';
import {
  CredentialRepositoryBusyError,
  CredentialRevisionConflictError,
  type RobinhoodCredentialRepository,
} from './credential-repository';
import type { RobinhoodCredentialBundle } from '../contracts/authentication';

export class UploadRoundTripError extends Error {
  override name = 'UploadRoundTripError';
}

/** Replace-mode upload would plant an older bundle over a newer stored
 *  grant — a stale export overwrites the live refresh token and kills the
 *  lineage (#1658 M3). Pass `force` only when the operator confirms. */
export class StaleUploadError extends Error {
  override name = 'StaleUploadError';
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
 *
 * Replace mode adds a freshness guard: CAS checks the revision, not
 * whether the uploaded grant is newer than the stored one — a stale
 * export file would overwrite the live refresh token with an
 * already-rotated one (the grant's last surviving copy). Refused unless
 * `force` is set.
 */
export async function uploadCredentialBundle(
  repository: RobinhoodCredentialRepository,
  bundle: RobinhoodCredentialBundle,
  options: { replace?: boolean; force?: boolean } = {},
): Promise<UploadEvidence> {
  let expectedRevision: number | null = null;
  if (options.replace) {
    const current = await repository.load();
    expectedRevision = current?.revision ?? null;
    const currentStamp = stamp(current);
    const bundleStamp = stamp(bundle);
    if (
      !options.force &&
      current !== null &&
      (!Number.isFinite(bundleStamp) ||
        !Number.isFinite(currentStamp) ||
        currentStamp > bundleStamp)
    ) {
      throw new StaleUploadError(
        'the stored grant is newer than or undatable against the uploaded ' +
          'bundle — the file likely predates the last rotation, or one ' +
          'side is missing lastTokenResponseAt. Re-export the current ' +
          'local bundle, or pass --force to overwrite anyway.',
      );
    }
  }
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

export interface SealLocalSourceResult {
  sealed: boolean;
  reason:
    | 'same_grant'
    | 'independent_grant'
    | 'no_source_grant'
    | 'stale_export'
    | 'rotated_during_seal';
  /** Operator attention needed — structural only, never token material. */
  warning?: string;
}

/** Seal is a fast local op — a short lease just fences an in-flight refresh. */
const SEAL_LEASE_TTL_MS = 15_000;

function stamp(bundle: RobinhoodCredentialBundle | null): number {
  const parsed = Date.parse(bundle?.lastTokenResponseAt ?? '');
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Closes the lineage fork an export→upload creates (issue #1658): when the
 * local store holds a copy of the grant that was just uploaded, both stores
 * would race the same refresh token — the first to rotate orphans the other.
 * Seal the source by deleting the local copy; the grant then lives only in
 * the destination store, and a re-bootstrap mints a fresh independent grant.
 * An independent local grant is left untouched.
 *
 * Identity limits — a refresh token match is necessary but not sufficient:
 * when the local grant refreshed BETWEEN export and upload, the exported rt
 * is already rotated server-side (a stale copy of the same lineage). Same
 * client_id + different rt + a NEWER local stamp strongly suggests that
 * case — the local copy is treated as the live one and never sealed; the
 * operator must re-export and re-upload so prod holds the current grant.
 * (Unparseable stamps on either side can't prove ordering — those fall
 * back to the ambiguous-lineage warning rather than a silent seal.)
 */
export async function sealLocalSourceIfCopied(
  localRepository: RobinhoodCredentialRepository,
  uploadedBundle: RobinhoodCredentialBundle,
): Promise<SealLocalSourceResult> {
  // Fence the compare→delete against an in-flight local refresh — rt can
  // rotate between the read and the delete, and deleting the rotated copy
  // would orphan the live grant.
  const leasePort = localRepository.refreshLease;
  const holderId = `seal-${randomUUID()}`;
  const lease = leasePort ? await leasePort.acquire(holderId, SEAL_LEASE_TTL_MS) : null;
  if (leasePort && !lease) {
    throw new CredentialRepositoryBusyError(
      'local credential store is mid-refresh — retry the seal',
    );
  }
  try {
    const local = await localRepository.load();
    const localRefreshToken = local?.tokens?.refresh_token;
    if (!localRefreshToken) {
      return { sealed: false, reason: 'no_source_grant' };
    }
    if (localRefreshToken === uploadedBundle.tokens?.refresh_token) {
      // Compare-and-delete on the observed revision — a zombie refresh
      // (lease expired mid-POST) can land a rotated grant between our
      // load() and the delete; an unconditional delete would remove the
      // only live copy while prod holds the dead uploaded rt (#1658 F3).
      try {
        await localRepository.delete(local!.revision);
      } catch (error) {
        if (error instanceof CredentialRevisionConflictError) {
          return {
            sealed: false,
            reason: 'rotated_during_seal',
            warning:
              'the local grant rotated while the seal was pending — ' +
              'nothing was deleted. The uploaded copy may be stale; ' +
              're-export from the now-live store and re-upload.',
          };
        }
        throw error;
      }
      // The delete committed — but a zombie refresh (lease expired mid-POST)
      // can resurrect the doc with its minted grant. Re-check inside the
      // still-held lease so we don't report "prod is the sole live copy"
      // while a resurrected doc sits locally and prod holds the dead rt.
      if ((await localRepository.load()) !== null) {
        return {
          sealed: false,
          reason: 'rotated_during_seal',
          warning:
            'the local grant was deleted, but an in-flight zombie refresh ' +
            'resurrected it with a rotated token — the LOCAL store now holds ' +
            'the only live copy and the uploaded prod grant is dead. ' +
            'Re-export from local and re-upload immediately.',
        };
      }
      return { sealed: true, reason: 'same_grant' };
    }
    const sameClient =
      local?.clientInformation?.client_id !== undefined &&
      local.clientInformation.client_id === uploadedBundle.clientInformation?.client_id;
    if (sameClient && stamp(local) > stamp(uploadedBundle)) {
      return {
        sealed: false,
        reason: 'stale_export',
        warning:
          'local grant is NEWER than the uploaded copy — the export is stale ' +
          '(the local grant refreshed after export). The uploaded refresh ' +
          'token is already rotated: production holds a dead grant, and any ' +
          'refresh attempt there may revoke the lineage. Re-export the ' +
          'current local bundle, re-upload, then seal.',
      };
    }
    return {
      sealed: false,
      reason: 'independent_grant',
      warning: sameClient
        ? 'client IDs match but refresh tokens differ — either an ' +
          'independent grant or a lineage that rotated between export and ' +
          'upload. If unsure which copy is live, do NOT re-upload from ' +
          'this local store — re-export from the known-live store or ' +
          'delete the suspect copy and re-bootstrap.'
        : undefined,
    };
  } finally {
    if (lease) {
      await leasePort!.release(lease).catch(() => undefined);
    }
  }
}
