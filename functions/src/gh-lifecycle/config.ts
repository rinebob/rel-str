/**
 * Supported repos for the getLifecycleTree callable (task #639).
 * Adding a repo is a one-line change + redeploy; the PAT's repo scope is
 * the real whitelist — this list is the request-validation surface.
 */

export interface SupportedRepo {
  owner: string;
  repo: string;
  /** GitHub Projects v2 number used for the node `status` decode; absent
   *  when the repo has no configured project — nodes carry no `status`. */
  projectNumber?: number;
}

export const SUPPORTED_REPOS: SupportedRepo[] = [
  { owner: 'rinebob', repo: 'rel-str', projectNumber: 1 },
  // SA repo entry lands with task #638 (PAT mint + repo details).
];
