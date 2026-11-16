/**
 * Verification: GitHub native sub-issue retrofit (task #1524, SHARED
 * Blueprint #1519). Exercises the real prod path of
 * scripts/retrofit-gh-subissues.ts — no mocks.
 *
 * Pipeline stages covered:
 *   1. Anchor enumeration + BFS parse (dry-run executes for real)
 *   2. Diff vs. live parentage (spot-checked against GraphQL ground truth)
 *   3. Apply persistence (#137's post-apply links confirmed natively)
 *   4. Idempotency (post-apply dry-run proposes zero new edges)
 *
 * Usage: npx tsx scripts/verify/dev-tools-retrofit-subissues-1524.ts
 * Needs: gh CLI authenticated. Read-only — never passes --apply.
 * Pass: exit 0. Fail: exit 1 with FAILED lines.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { SUPPORTED_REPOS } from '../../functions/src/gh-lifecycle/config';
import type { IntendedEdge, EdgeDiff, BlockedEdge, SupersededEdge } from '../../shared/retrofit-hierarchy';

interface Report {
  anchors: number;
  intended: number;
  diff: EdgeDiff;
  blocked: BlockedEdge[];
  superseded: SupersededEdge[];
  skippedAnchorChildren: IntendedEdge[];
}

const REPOS = SUPPORTED_REPOS.map((r) => `${r.owner}-${r.repo}`);
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function ghGraphql(query: string): unknown {
  const out = execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`], { encoding: 'utf-8' });
  return JSON.parse(out);
}

// ── 1. dry-run executes for real, writes reports ─────────────────────────
mkdirSync('.devin/tmp', { recursive: true });
const before = new Set(readdirSync('.devin/tmp').filter((f) => f.startsWith('retrofit-gh-subissues-')));
const run = spawnSync('npx', ['tsx', 'scripts/retrofit-gh-subissues.ts'], { encoding: 'utf-8', shell: true });
check('dry-run completes (exit 0 or 2)', run.status === 0 || run.status === 2, `exit=${run.status}`);

const fresh = readdirSync('.devin/tmp')
  .filter((f) => f.startsWith('retrofit-gh-subissues-') && !before.has(f));
const reports = new Map<string, Report>();
for (const slug of REPOS) {
  const file = fresh.filter((f) => f.includes(slug)).sort().pop();
  check(`report written for ${slug}`, !!file, file ?? 'none');
  if (file) reports.set(slug, JSON.parse(readFileSync(`.devin/tmp/${file}`, 'utf-8')) as Report);
}

// ── 2. report invariants ─────────────────────────────────────────────────
for (const [slug, r] of reports) {
  const d = r.diff;
  const total = d.proposed.length + d.alreadyCorrect.length + d.conflicts.length + d.unresolved.length + (r.blocked?.length ?? 0);
  check(`${slug}: every intended edge lands in exactly one bucket`, total === r.intended, `buckets=${total} intended=${r.intended}`);
  check(`${slug}: post-apply proposes zero new edges`, d.proposed.length === 0, `proposed=${d.proposed.length}`);
  check(`${slug}: anchors scanned`, r.anchors > 0, `${r.anchors}`);
}

// ── 3. spot-check live parentage for alreadyCorrect edges ────────────────
const relStr = reports.get('rinebob-rel-str');
if (relStr) {
  for (const e of relStr.diff.alreadyCorrect.slice(0, 3)) {
    const res = ghGraphql(`query { repository(owner:"rinebob",name:"rel-str") { issue(number:${e.child}) { parent { number } } } }`) as {
      data: { repository: { issue: { parent: { number: number } | null } } };
    };
    check(`live parent #${e.child} == #${e.parent}`, res.data.repository.issue.parent?.number === e.parent);
  }
}

// ── 4. #137's applied links are natively present ─────────────────────────
const subs = ghGraphql(`query { repository(owner:"rinebob",name:"rel-str") { issue(number:137) { subIssues(first:100) { nodes { number } } } } }`) as {
  data: { repository: { issue: { subIssues: { nodes: { number: number }[] } } } };
};
const subNums = new Set(subs.data.repository.issue.subIssues.nodes.map((n) => n.number));
for (const n of [138, 141, 153, 155, 158]) {
  check(`#137 sub-issues natively include #${n}`, subNums.has(n));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
