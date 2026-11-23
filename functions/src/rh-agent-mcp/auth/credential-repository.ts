import type { RobinhoodCredentialBundle } from '../contracts/authentication';

export interface RobinhoodCredentialRepository {
  load(): Promise<RobinhoodCredentialBundle | null>;
  store(
    credential: RobinhoodCredentialBundle,
    expectedRevision: number | null,
  ): Promise<RobinhoodCredentialBundle>;
  /** Delete the stored bundle. When `expectedRevision` is given, the
   *  compare happens inside the same atomic unit as the delete — a store()
   *  that landed in between turns this into a CredentialRevisionConflictError
   *  instead of deleting a grant that rotated under the caller (issue #1658:
   *  the seal's load→delete gap against a zombie refresh's write). */
  delete(expectedRevision?: number): Promise<void>;
  /** Optional refresh-lock port — present only when the store can serialize
   *  the refresh POST across processes/instances (issue #1658). Repos without
   *  it keep the legacy unguarded refresh path. */
  readonly refreshLease?: RefreshLeasePort;
}

/** Symmetric cipher over a serialized credential bundle (DPAPI, KMS, test). */
export interface CredentialCipher {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

/**
 * Single refresh slot across processes/instances sharing one credential
 * store. CAS/locks on `store()` only guard the WRITE — the refresh POST to
 * Robinhood must be serialized too, because a second POST presenting an
 * already-rotated refresh token gets the grant revoked (issue #1658).
 *
 * The winner holds the lease across load → POST → CAS-write; losers wait
 * for the winner's revision bump and adopt its tokens instead of POSTing.
 *
 * Bounded guarantee: the slot is TTL'd, not fenced. A holder whose critical
 * section outlives its TTL can be taken over while its POST is still in
 * flight — the TTL must comfortably exceed load→POST→write (~seconds, not
 * the TTL's tens of seconds).
 */
export interface RefreshLease {
  holderId: string;
}

export interface RefreshLeasePort {
  /** Current stored revision — the poll losers use to detect the winner's
   *  write landing. Cheap where the store allows it (the KMS impl reads the
   *  doc without decrypting; file impls pay a full load). */
  currentRevision(): Promise<number | null>;
  /** Try to take the refresh slot. Returns the lease when won, null when
   *  another live holder is refreshing. Winner MUST call release(). */
  acquire(holderId: string, ttlMs: number): Promise<RefreshLease | null>;
  release(lease: RefreshLease): Promise<void>;
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
