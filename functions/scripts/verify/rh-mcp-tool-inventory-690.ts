/**
 * Verify task #690 — canonical discovery doc completeness. Disk-only:
 * no credentials, no network, no MCP session.
 *
 * Checks against `docs/topics/657-rh-mcp/rh-mcp-tool-discovery-canonical-*.md`
 * (main index doc) plus its `rh-mcp-tools-*.md` per-category children:
 *  - every catalog tool name appears as a `### <tool>` section in a child doc
 *  - every section carries `**Safety:**`, `**Parameters`, `**Notes:**`
 *    and at least one `captures/*.json` link (the observed-response
 *    evidence block; error-only tools link error captures)
 *  - the main doc's coverage matrix has exactly one row per catalog tool
 *  - no capture file leaks an account number: every
 *    `account_number`/`rhs_account_number` JSON field is masked
 *    (`••••`) or an `$ENV:` placeholder, and the real account values
 *    from `.env.local` (if readable) appear nowhere verbatim
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/rh-mcp-tool-inventory-690.ts [--doc <path>]
 *
 * `--doc` overrides the main doc path; child docs resolve as
 * `rh-mcp-tools-*.md` siblings of that path. Used to prove the script
 * fails when a tool section is removed (see rh-mcp-tool-inventory-690.md).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToolCatalog } from '../../src/rh-agent-mcp/tools/robinhood-tools';

const DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(DIR, '..', '..', '..');
const TOPIC_DIR = join(REPO_ROOT, 'docs', 'topics', '657-rh-mcp');
const CAPTURES_DIR = join(TOPIC_DIR, 'captures');
const ENV_PATH = join(REPO_ROOT, '.env.local');

const docArg = process.argv.indexOf('--doc');
if (docArg !== -1 && process.argv[docArg + 1] === undefined) {
  console.error('FAIL  --doc requires a path argument');
  process.exit(1);
}
const DOC_PATH =
  docArg !== -1
    ? (process.argv[docArg + 1] as string)
    : join(TOPIC_DIR, 'rh-mcp-tool-discovery-canonical-657-658-689.md');

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  OK  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const catalog = await loadToolCatalog();
const catalogNames = new Set(catalog.tools.map((t) => t.name));

const doc = readFileSync(DOC_PATH, 'utf-8');
// Tool sections live in the per-category children next to the main doc.
const CHILD_RE = /^rh-mcp-tools-[\w-]+\.md$/;
const childPaths = readdirSync(dirname(DOC_PATH))
  .filter((f) => CHILD_RE.test(f))
  .map((f) => join(dirname(DOC_PATH), f));
const childDocs = new Map<string, string>(
  childPaths.map((p) => [p, readFileSync(p, 'utf-8')]),
);

const sections = new Map<string, string>();
for (const [, text] of childDocs) {
  const heads = [...text.matchAll(/^### (\w+)[^\n]*/gm)];
  heads.forEach((h, i) => {
    const start = (h.index ?? 0) + h[0].length;
    const end = i + 1 < heads.length ? (heads[i + 1].index ?? text.length) : text.length;
    sections.set(h[1], text.slice(start, end));
  });
}
// All generated text — capture links and secrets can appear anywhere.
const allDocs = [doc, ...childDocs.values()].join('\n');

console.log(`doc: ${DOC_PATH}`);
console.log(
  `catalog: ${catalogNames.size} tools · children: ${childDocs.size} · doc: ${sections.size} sections`,
);

check('every catalog tool has a doc section', () => {
  const missing = [...catalogNames].filter((n) => !sections.has(n));
  assert(missing.length === 0, `missing sections: ${missing.join(', ')}`);
});

check('no doc sections for tools absent from the catalog', () => {
  const extra = [...sections.keys()].filter((n) => !catalogNames.has(n));
  assert(extra.length === 0, `extra sections: ${extra.join(', ')}`);
});

check('every section carries Safety + Parameters + Notes', () => {
  const bad = [...sections.entries()]
    .filter(
      ([, body]) =>
        !body.includes('**Safety:**') ||
        !body.includes('**Parameters') ||
        !body.includes('**Notes:**'),
    )
    .map(([n]) => n);
  assert(bad.length === 0, `incomplete sections: ${bad.join(', ')}`);
});

check('every section links >=1 capture (observed response evidence)', () => {
  const bad = [...sections.entries()]
    .filter(([, body]) => !/captures\/[\w.-]+\.json/.test(body))
    .map(([n]) => n);
  assert(bad.length === 0, `no capture links: ${bad.join(', ')}`);
});

check('every linked capture file exists on disk', () => {
  const onDisk = new Set(readdirSync(CAPTURES_DIR));
  const missing = new Set<string>();
  for (const m of allDocs.matchAll(/captures\/([\w.-]+\.json)/g)) {
    if (!onDisk.has(m[1])) missing.add(m[1]);
  }
  assert(missing.size === 0, `missing files: ${[...missing].join(', ')}`);
});

check('coverage matrix row count == catalog tool count', () => {
  const matrix = doc.match(/## Coverage matrix([\s\S]*?)(?=\n## )/);
  assert(matrix !== null, 'no Coverage matrix section');
  const rows = matrix[1]
    .split('\n')
    .filter((l) => /^\| \[?\w+/.test(l) && !/^\| tool /.test(l));
  assert(
    rows.length === catalogNames.size,
    `matrix rows ${rows.length} != catalog ${catalogNames.size}`,
  );
});

const ACCT_FIELD = /"(?:rhs_)?account_number"\s*:\s*"([^"]+)"/g;
const MASK = '•';

check('no unmasked account_number values in any capture', () => {
  const leaks: string[] = [];
  for (const file of readdirSync(CAPTURES_DIR).filter((f) => f.endsWith('.json'))) {
    const text = readFileSync(join(CAPTURES_DIR, file), 'utf-8');
    for (const m of text.matchAll(ACCT_FIELD)) {
      const v = m[1];
      // Allowed: masked (••••), $ENV: placeholders, and the intentional
      // bogus value "0" used by the err-positions-bad-acct error probe.
      if (!v.includes(MASK) && !v.startsWith('$ENV:') && v !== '0') {
        leaks.push(`${file}: ${v}`);
      }
    }
  }
  assert(leaks.length === 0, `unmasked account numbers: ${leaks.join(', ')}`);
});

check('real account numbers from .env.local absent verbatim', () => {
  if (!existsSync(ENV_PATH)) {
    console.log('    (skipped — .env.local not present)');
    return;
  }
  const env = readFileSync(ENV_PATH, 'utf-8');
  const secrets = [...env.matchAll(/^(RH_(?:RHS_)?ACCOUNT_NUMBER)=(.+)$/gm)]
    .map((m) => m[2].trim())
    .filter((v) => v.length > 0);
  if (secrets.length === 0) {
    console.log('    (skipped — no account vars in .env.local)');
    return;
  }
  const hits: string[] = [];
  const targets = [
    ['main doc', doc],
    ...[...childDocs.entries()].map(([p, text]) => [p.split(/[\\/]/).pop() ?? p, text] as const),
    ...readdirSync(CAPTURES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f, readFileSync(join(CAPTURES_DIR, f), 'utf-8')] as const),
  ];
  for (const [file, text] of targets) {
    for (const secret of secrets) {
      if (text.includes(secret)) hits.push(`${file} contains ${secret.slice(-4)}`);
    }
  }
  assert(hits.length === 0, `verbatim leaks: ${hits.join(', ')}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
