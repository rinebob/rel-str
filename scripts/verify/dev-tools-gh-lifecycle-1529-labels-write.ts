/**
 * Verifies the write label callables' handlers (task #1529) end-to-end:
 * ghLabelWriteDeps wiring → real GitHub REST → attach/detach/create/
 * rename/delete — everything except the HTTP onCall wrapper.
 *
 * ⚠ WRITES TO THE REAL REPO. Self-contained: creates a sacrificial
 * "uat-verify-1529" issue via `gh issue create`, exercises the callables
 * against it, then deletes every scratch label and closes the issue.
 *
 * Token: GITHUB_WRITE_TOKEN env, else `gh auth token` fallback (the gh
 * CLI token already has repo write scope).
 *
 * Usage: npx tsx scripts/verify/dev-tools-gh-lifecycle-1529-labels-write.ts
 */

import { execSync } from 'node:child_process';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  handleManageRepoLabel,
  handleUpdateIssueLabels,
  ghLabelWriteDeps,
} from '../../functions/src/gh-lifecycle/label-callables';
import type {
  ManageRepoLabelRequest,
  UpdateIssueLabelsRequest,
} from '../../shared/lifecycle-labels';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function token(): void {
  if (process.env.GITHUB_WRITE_TOKEN) return;
  try {
    process.env.GITHUB_WRITE_TOKEN = execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    console.error('No GITHUB_WRITE_TOKEN and `gh auth token` failed');
    process.exit(2);
  }
}

const ureq = (data: UpdateIssueLabelsRequest): CallableRequest<UpdateIssueLabelsRequest> =>
  ({ data, auth: { uid: 'verify-script' } }) as CallableRequest<UpdateIssueLabelsRequest>;
const mreq = (data: ManageRepoLabelRequest): CallableRequest<ManageRepoLabelRequest> =>
  ({ data, auth: { uid: 'verify-script' } }) as CallableRequest<ManageRepoLabelRequest>;

const gh = (cmd: string): string =>
  execSync(`gh ${cmd}`, { encoding: 'utf8' }).trim();

const REPO = { owner: 'rinebob', repo: 'rel-str' };
const SCRATCH = 'uat-verify-1529';
const SCRATCH_B = 'uat-verify-1529-b';
const SCRATCH_B2 = 'uat-verify-1529-b2';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main(): Promise<void> {
  token();
  const deps = ghLabelWriteDeps();

  const url = gh('issue create --repo rinebob/rel-str --title "uat-verify-1529 scratch" --body "Auto-created by dev-tools-gh-lifecycle-1529-labels-write.ts — closed on completion."');
  const issueNumber = Number(url.split('/').pop());
  console.log(`\n--- sacrificial issue #${issueNumber} created (${url}) ---`);
  check('scratch issue created', Number.isInteger(issueNumber) && issueNumber > 0);

  const ISSUE = { ...REPO, issueNumber };
  try {
    console.log('\n--- updateIssueLabels: add (mints missing label) ---');
    const add = await handleUpdateIssueLabels(
      ureq({ ...ISSUE, add: [SCRATCH], remove: [] }), deps);
    check('response carries the scratch label', add.labels.includes(SCRATCH));
    check('created lists the minted name', add.created.includes(SCRATCH));

    console.log('\n--- manageRepoLabel: delete in-use label → usageCount ---');
    // The issues?labels= filter is eventually consistent — observed lag
    // >5s. Poll an independent read until the index shows the attach
    // (bounded), or the count legitimately under-reads.
    let indexed = false;
    for (let i = 0; i < 12 && !indexed; i++) {
      await sleep(5000);
      const seen = JSON.parse(gh(
        `api "repos/rinebob/rel-str/issues?labels=${SCRATCH}&state=all&per_page=100"`)) as unknown[];
      indexed = Array.isArray(seen) && seen.length === 1;
    }
    check('label index caught up within 60s', indexed);
    const del = await handleManageRepoLabel(
      mreq({ ...REPO, op: 'delete', name: SCRATCH }), deps);
    check('usageCount counts the scratch issue', del.usageCount === 1,
      `usageCount=${del.usageCount}`);

    console.log('\n--- updateIssueLabels: remove ---');
    // Label was deleted above (GitHub detaches) — recreate then remove
    // to exercise the detach path explicitly.
    await handleUpdateIssueLabels(ureq({ ...ISSUE, add: [SCRATCH], remove: [] }), deps);
    const rem = await handleUpdateIssueLabels(
      ureq({ ...ISSUE, add: [], remove: [SCRATCH] }), deps);
    check('scratch label detached', !rem.labels.includes(SCRATCH));

    console.log('\n--- manageRepoLabel: create → rename → delete ---');
    await handleManageRepoLabel(mreq({ ...REPO, op: 'create', name: SCRATCH_B }), deps);
    await handleManageRepoLabel(
      mreq({ ...REPO, op: 'update', name: SCRATCH_B, newName: SCRATCH_B2 }), deps);
    const del2 = await handleManageRepoLabel(
      mreq({ ...REPO, op: 'delete', name: SCRATCH_B2 }), deps);
    check('renamed label deleted with zero usage', del2.usageCount === 0,
      `usageCount=${del2.usageCount}`);
  } finally {
    // Best-effort cleanup — nothing scratch may survive a failed run.
    for (const name of [SCRATCH, SCRATCH_B, SCRATCH_B2]) {
      try {
        await handleManageRepoLabel(mreq({ ...REPO, op: 'delete', name }), deps);
      } catch { /* absent — fine */ }
    }
    try {
      gh(`issue close ${issueNumber} --repo rinebob/rel-str`);
      console.log(`  scratch issue #${issueNumber} closed`);
    } catch {
      console.log(`  WARN scratch issue #${issueNumber} close failed — close it manually`);
    }
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('UNEXPECTED:', err);
  process.exit(1);
});
