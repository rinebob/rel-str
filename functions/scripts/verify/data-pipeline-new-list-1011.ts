/**
 * NEW-list census for #1011 — every tracked symbol is filed in an
 * exclusive list, and no symbol sits in two exclusive docs. Checks:
 *
 *   1. CODE — the sweep core in common/st-new-list-sweep.ts carries the
 *      additive-only contract (arrayUnion member writes, exclusive-key
 *      classification) and the script consumes it. FAIL: core absent
 *      or the script's logic drifted off it.
 *
 *   2. PROD (read-only) — the sweep's own census across BOTH roots:
 *      universe (legacy `savant-trader/data/symbols` ∪ `st-symbols`,
 *      `enabled !== false`), exclusive membership via the shared
 *      summarizeListDocs (legacy lists ∪ `st-symbol-lists`),
 *      unlisted count. 0 unlisted → OK; >0 → WARN (actionable:
 *      `npx tsx scripts/sweep-unlisted-to-new.ts --apply`). A symbol
 *      filed in ≥2 distinct exclusive docs → WARN (dual membership —
 *      arrayUnion can't rescind a concurrent user move).
 *
 *   3. NEW doc — the resolved target is audited in BOTH legs: exists,
 *      meta shape (a stamped `key`/`role` must match NEW/exclusive;
 *      the bare `{name}`-era shape with neither is accepted), member
 *      count. Multi-NEW-doc drift is flagged.
 *
 *   4. List-root parity — doc ids present in one root but absent from
 *      the other: INFO, mirror drift signal for #1013 teardown.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-new-list-1011.ts
 *
 * Read-only — never writes. Exit 0 on clean audit; nonzero on any FAIL.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../../src/firebase-admin-init';
import {
  ST_SYMBOLS_COLLECTION,
  ST_SYMBOL_LISTS_COLLECTION,
  ST_SYMBOLS_ROOT,
  ST_SYMBOL_LISTS_ROOT,
} from '../../src/common/st-collections';
import {
  computeUnlisted,
  enabledSymbolIds,
  EXCLUSIVE_LIST_KEYS,
  listKeyOf,
  NEW_LIST_KEY,
  resolveNewListTarget,
  summarizeListDocs,
} from '../../src/common/st-new-list-sweep';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

let fails = 0;
let warns = 0;
const ok = (m: string) => console.log(`OK   ${m}`);
const warn = (m: string) => { warns++; console.log(`WARN ${m}`); };
const fail = (m: string) => { fails++; console.log(`FAIL ${m}`); };
const info = (m: string) => console.log(`INFO ${m}`);

async function main() {
  console.log('#1011 NEW-list census\n');

  // ── 1. code invariant ──────────────────────────────────────────────────
  const core = readFileSync(`${SRC_ROOT}/common/st-new-list-sweep.ts`, 'utf8');
  const script = readFileSync(
    join(SRC_ROOT, '..', 'scripts', 'sweep-unlisted-to-new.ts'), 'utf8');
  if (/arrayUnion/.test(core) && /EXCLUSIVE_LIST_KEYS/.test(core)) {
    ok('sweep core carries arrayUnion + exclusive-key classification');
  } else {
    fail('st-new-list-sweep core missing additive-only contract');
  }
  if (/st-new-list-sweep/.test(script)) {
    ok('sweep script consumes the shared core');
  } else {
    fail('sweep-unlisted-to-new.ts drifted off the shared core');
  }

  // ── 2. prod census (the sweep's own reads, both roots) ────────────────
  const [legacySyms, canonSyms, legacyLists, canonLists] = await Promise.all([
    db.collection(ST_SYMBOLS_COLLECTION).select('enabled').get(),
    db.collection(ST_SYMBOLS_ROOT).select('enabled').get(),
    db.collection(ST_SYMBOL_LISTS_COLLECTION).get(),
    db.collection(ST_SYMBOL_LISTS_ROOT).get(),
  ]);

  const universe = enabledSymbolIds([...legacySyms.docs, ...canonSyms.docs]);
  const listDocs = [...legacyLists.docs, ...canonLists.docs];
  const { members, newDocIds, uids } = summarizeListDocs(listDocs);
  const unlisted = computeUnlisted(universe, members);

  console.log(
    `\nUniverse:          ${universe.size} (legacy ${legacySyms.size} + canonical ${canonSyms.size})`,
  );
  console.log(`List docs:         ${listDocs.length} (legacy ${legacyLists.size} + canonical ${canonLists.size})`);
  console.log(`Exclusive members: ${members.size}`);
  console.log(`Unlisted:          ${unlisted.length}`);

  if (unlisted.length === 0) {
    ok('every tracked symbol is filed in an exclusive list');
  } else {
    warn(
      `${unlisted.length} symbols unlisted — actionable: ` +
        `npx tsx scripts/sweep-unlisted-to-new.ts --apply\n     ${unlisted.slice(0, 20).join(' ')}`,
    );
  }

  // Dual exclusive membership: a symbol in ≥2 DISTINCT exclusive docs
  // is drift (the sweep's non-transactional read→write window can't
  // rescind a concurrent user move — arrayUnion only adds). Counted
  // per doc id so a doc mirrored across both roots isn't double-counted.
  const homes = new Map<string, Set<string>>();
  for (const d of listDocs) {
    const data = d.data();
    if (!EXCLUSIVE_LIST_KEYS.has(listKeyOf(d.id, data))) continue;
    const symbols = Array.isArray(data['symbols']) ? data['symbols'] : [];
    for (const s of symbols) {
      const sym = String(s).trim().toUpperCase();
      const set = homes.get(sym) ?? new Set<string>();
      set.add(d.id);
      homes.set(sym, set);
    }
  }
  const dual = [...homes.entries()].filter(([, ids]) => ids.size > 1).map(([s]) => s).sort();
  if (dual.length === 0) {
    ok('no symbol sits in two exclusive docs');
  } else {
    warn(`${dual.length} symbols in ≥2 exclusive docs: ${dual.slice(0, 20).join(' ')}`);
  }

  // ── 3. NEW doc audit — both legs ───────────────────────────────────────
  if (newDocIds.length > 1) {
    // The sweep itself errors on this state — report, don't crash
    // (resolveNewListTarget would throw and skip the rest of §3/§4).
    warn(`multi-NEW drift: ${newDocIds.join(', ')} — sweep needs --uid`);
  } else if (newDocIds.length === 0 && uids.size !== 1) {
    warn(
      `no NEW doc and ${uids.size} uids — ` +
        (uids.size === 0 ? 'store predates uid stamping' : 'sweep would need --uid'),
    );
  } else {
    const target = resolveNewListTarget({ newDocIds, uids });
    for (const [label, root] of [
      ['legacy', ST_SYMBOL_LISTS_COLLECTION],
      ['canonical', ST_SYMBOL_LISTS_ROOT],
    ] as const) {
      const snap = await db.collection(root).doc(target).get();
      if (!snap.exists) {
        warn(`NEW doc ${target} absent in ${label} — next sweep mints it there`);
        continue;
      }
      const d = snap.data()!;
      const count = (d['symbols'] as string[] | undefined)?.length ?? 0;
      // Stamped docs must agree; the bare {name}-era shape (no key, no
      // role) is the legacy mint and is accepted as NEW by the FE. A
      // stamped `key` WITHOUT `role` is the half-migrated shape — the
      // FE reads the doc as a registry list and defaults role to
      // nonexclusive, un-triaging its members.
      if (d['key'] !== undefined && d['key'] !== NEW_LIST_KEY) {
        warn(`NEW doc ${target} (${label}) carries key=${d['key']} — meta drift`);
      } else if (d['key'] === NEW_LIST_KEY && d['role'] === undefined) {
        warn(`NEW doc ${target} (${label}) stamped key without role — half-migrated, FE reads it nonexclusive`);
      } else if (d['role'] !== undefined && d['role'] !== 'exclusive') {
        warn(`NEW doc ${target} (${label}) carries role=${d['role']} — meta drift`);
      } else {
        ok(`NEW doc ${target} (${label}) present (${count} members)`);
      }
    }
  }

  // ── 4. list-root parity (mirror drift signal → #1013) ──────────────────
  const legacyIds = new Set(legacyLists.docs.map((d) => d.id));
  const canonIds = new Set(canonLists.docs.map((d) => d.id));
  const legacyOnly = [...legacyIds].filter((i) => !canonIds.has(i));
  const canonOnly = [...canonIds].filter((i) => !legacyIds.has(i));
  if (legacyOnly.length === 0 && canonOnly.length === 0) {
    ok(`list roots at doc-id parity (${legacyIds.size} docs each)`);
  } else {
    info(`list-root drift: legacy-only ${legacyOnly.join(',') || 'none'} | canon-only ${canonOnly.join(',') || 'none'}`);
  }

  console.log(`\n${fails} FAIL / ${warns} WARN`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('AUDIT CRASH:', e);
  process.exit(1);
});
