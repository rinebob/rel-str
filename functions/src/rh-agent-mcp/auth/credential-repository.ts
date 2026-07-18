import type { RobinhoodCredentialBundle } from '../contracts/authentication';

export interface RobinhoodCredentialRepository {
  load(): Promise<RobinhoodCredentialBundle | null>;
  store(
    credential: RobinhoodCredentialBundle,
    expectedRevision: number | null,
  ): Promise<RobinhoodCredentialBundle>;
  delete(): Promise<void>;
}
