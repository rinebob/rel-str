/**
 * Verify: workflow template + conventions doc structure (task #647).
 *
 * Docs-only task — no prod services involved. Checks:
 *   1. The conventions doc exists and defines the full template
 *      (every required header field + section).
 *   2. Optionally, that a workflow doc instantiates the template:
 *      every header field present, Steps has >=1 checkbox item
 *      ([ ] or [x] — ticking is allowed by the doc-as-script model),
 *      Feeds present (explicit 'none' allowed), each required
 *      section present AND non-empty, and every step names a
 *      destination (` — where`) or is tagged (manual).
 *      Fenced code blocks are stripped before parsing, so a doc may
 *      quote the template without confusing the checks.
 *
 * Usage:
 *   npx tsx scripts/verify/workflows-template-647.ts [path-to-workflow-doc]
 *
 * With no argument it verifies the conventions doc only.
 * Exit 0 = all checks pass; 1 = any failure.
 */

import { readFileSync, existsSync } from 'node:fs';

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const CONVENTIONS =
  'docs/topics/625-workflows/625-646-647-CONVENTIONS-workflows-trading-workflows.md';

const NAMING_PATTERN =
  '625-{stage-issue-#}-{task-#}-WORKFLOW-workflows-{workflow-slug}.md';
const TEMPLATE_FIELDS = ['Purpose', 'When', 'Timebox', 'Inputs', 'Feeds'];
const TEMPLATE_SECTIONS = ['## Steps', '## Exit criteria', '## Parking lot'];

/** Strip fenced code blocks so quoted templates can't confuse section parsing. */
function stripFences(doc: string): string {
  return doc.replace(/```[\s\S]*?```/g, '');
}

/** Lines of a `## X` section: from the heading (exclusive) to the next `## ` heading. */
function sectionLines(doc: string, heading: string): string[] | null {
  const lines = doc.split('\n');
  const start = lines.findIndex(l => l.trim() === heading);
  if (start < 0) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

// ── 1. Conventions doc ────────────────────────────────────────────────────────
check('conventions doc exists', existsSync(CONVENTIONS), CONVENTIONS);
if (existsSync(CONVENTIONS)) {
  const conv = readFileSync(CONVENTIONS, 'utf8');
  check('conventions defines naming pattern', conv.includes(NAMING_PATTERN));
  check('conventions defines doc-as-script model', conv.includes('script, not a ledger'));
  check('conventions defines (manual) tag', conv.includes('(manual)'));
  check('conventions defines explicit Feeds:none', conv.includes('**Feeds:** none'));
  check('conventions defines per-workflow Thread model', conv.includes('/proj add-thread 625'));
  for (const f of TEMPLATE_FIELDS) {
    check(`conventions embeds field "${f}"`, conv.includes(`**${f}:**`));
  }
  for (const s of TEMPLATE_SECTIONS) {
    check(`conventions embeds section "${s}"`, conv.includes(s));
  }
}

// ── 2. Optional: a workflow doc conforms to the template ─────────────────────
const target = process.argv[2];
if (target) {
  check('workflow doc exists', existsSync(target), target);
  if (existsSync(target)) {
    const doc = stripFences(readFileSync(target, 'utf8'));
    for (const f of TEMPLATE_FIELDS) {
      check(`workflow has **${f}:**`, doc.includes(`**${f}:**`));
    }
    // Feeds must be explicit — 'none' is allowed, empty/absent is not.
    const feeds = doc.match(/\*\*Feeds:\*\*\s*(.+)/);
    check('Feeds is non-empty or explicit "none"', !!feeds && feeds[1].trim().length > 0,
      feeds ? `feeds="${feeds[1].trim()}"` : 'no Feeds line');
    for (const s of TEMPLATE_SECTIONS) {
      const lines = sectionLines(doc, s);
      check(`workflow has non-empty section "${s}"`,
        !!lines && lines.some(l => l.trim().length > 0));
    }
    const stepBlock = (sectionLines(doc, '## Steps') ?? []).join('\n');
    const steps = stepBlock.match(/^- \[[ x]\] /gm) ?? [];
    check('Steps has >=1 checkbox item ([ ] or [x])', steps.length > 0, `${steps.length} found`);
    // Each step names a destination after ' — ' or is tagged (manual).
    // The (~n min) estimate is stripped first so it can't count as the destination.
    const untagged = stepBlock
      .split('\n')
      .filter(l => /^- \[[ x]\] /.test(l))
      .map(l => l.replace(/\(~\d+\s*min\)/g, ''))
      .filter(l => !/\(manual\)/.test(l) && !/[—–]\s*\S/.test(l));
    check('every step names a destination or is (manual)', untagged.length === 0,
      untagged.length ? `untagged: ${untagged[0].trim().slice(0, 60)}` : undefined);
  }
} else {
  console.log('\n(no workflow doc arg — conventions checks only)');
}

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`} ===`);
process.exit(failures === 0 ? 0 : 1);
