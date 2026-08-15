/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * In-memory Robinhood credential repository backed by the `RH_CREDENTIAL_BUNDLE`
 * environment variable. Used by a Cloud Function that already has the secret
 * injected into its runtime environment.
 */

import type { RobinhoodCredentialBundle } from '../contracts/authentication';
import type { RobinhoodCredentialRepository } from './credential-repository';

export class EnvCredentialRepository implements RobinhoodCredentialRepository {
  constructor(private bundle: RobinhoodCredentialBundle | null) {}

  async load(): Promise<RobinhoodCredentialBundle | null> {
    return this.bundle;
  }

  async store(
    credential: RobinhoodCredentialBundle,
    expectedRevision: number | null,
  ): Promise<RobinhoodCredentialBundle> {
    const current = this.bundle;
    if ((current?.revision ?? null) !== expectedRevision) {
      throw new Error(
        `Credential revision conflict: expected ${expectedRevision}, found ${current?.revision ?? null}`,
      );
    }
    const next: RobinhoodCredentialBundle = {
      ...credential,
      schemaVersion: 1,
      revision: (current?.revision ?? 0) + 1,
    };
    this.bundle = next;
    return next;
  }

  async delete(): Promise<void> {
    this.bundle = null;
  }
}
