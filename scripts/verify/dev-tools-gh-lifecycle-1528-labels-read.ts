/**
 * Verifies the listRepoLabels callable's handler (task #1528) end-to-end:
 * ghLabelReadDeps wiring → real GitHub REST paging → RepoLabel[] shape —
 * everything except the HTTP onCall wrapper. Read-only.
 *
 * Token: GITHUB_READ_TOKEN env, else `gh auth token` fallback.
 *
 * Usage: npx tsx scripts/verify/dev-tools-gh-lifecycle-1528-labels-read.ts
 */

import { execSync } from 'node:child_process';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  handleListRepoLabels,
  ghLabelReadDeps,
} from '../../functions/src/gh-lifecycle/label-callables';
import type { ListRepoLabelsRequest } from '../../shared/lifecycle-labels';

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
  if (process.env.GITHUB_READ_TOKEN) return;
  try {
    process.env.GITHUB_READ_TOKEN = execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    console.error('No GITHUB_READ_TOKEN and `gh auth token` failed');
    process.exit(2);
  }
}

const req = (data: ListRepoLabelsRequest): CallableRequest<ListRepoLabelsRequest> =>
  ({ data, auth: { uid: 'verify-script' } }) as CallableRequest<ListRepoLabelsRequest>;

async function main(): Promise<void> {
  token();
  const deps = ghLabelReadDeps();

  console.log('\n--- listRepoLabels handler, real deps (rel-str) ---');
  const res = await handleListRepoLabels(req({ owner: 'rinebob', repo: 'rel-str' }), deps);

  check('labels non-empty', res.labels.length > 0, `${res.labels.length} labels`);
  check('fetchedAt is fresh ISO', Date.now() - Date.parse(res.fetchedAt) < 60_000);
  check('every label has name + 6-hex color',
    res.labels.every(l => typeof l.name === 'string' && /^[0-9a-fA-F]{6}$/.test(l.color)),
    res.labels.filter(l => !/^[0-9a-fA-F]{6}$/.test(l.color)).map(l => l.name).join('; '));
  // The workflow taxonomy must be present — these are the labels the
  // guard hides from the picker.
  const names = new Set(res.labels.map(l => l.name));
  for (const known of ['INTERNAL', '5_IMPLEMENT', 'DEV-TOOLS', 'FEATURE']) {
    check(`known system label "${known}" present`, names.has(known));
  }
  console.log(`  labels: ${res.labels.length} (${[...names].slice(0, 8).join(', ')}…)`);
  // Independent completeness check — `gh label list` is a separate
  // reader; equal counts mean the handler dropped nothing.
  const liveCount = (repo: string) =>
    Number(execSync(`gh label list --repo rinebob/${repo} --limit 200 --json name -q length`,
      { encoding: 'utf8' }).trim());
  check('handler count matches gh label list (rel-str)',
    res.labels.length === liveCount('rel-str'),
    `${res.labels.length} vs ${liveCount('rel-str')}`);
  // Both supported repos carry <100 labels today (rel-str 68,
  // av-proxy-api 49 at review time) — the >100-page path is spec-covered
  // by the 101-label fixture, not live-observable. Note it, don't fake it.
  if (res.labels.length <= 100) {
    console.log(`  info rel-str has ${res.labels.length} labels (<100) — multi-page paging is unit-spec evidence only`);
  }

  console.log('\n--- av-proxy-api second repo ---');
  const res2 = await handleListRepoLabels(req({ owner: 'rinebob', repo: 'av-proxy-api' }), deps);
  check('second repo labels fetch succeeds', Array.isArray(res2.labels));
  check('handler count matches gh label list (av-proxy-api)',
    res2.labels.length === liveCount('av-proxy-api'),
    `${res2.labels.length} vs ${liveCount('av-proxy-api')}`);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('UNEXPECTED:', err);
  process.exit(1);
});
