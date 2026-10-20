/**
 * @topic #984 — ST Firestore Reorg (task #1011)
 *
 * NEW-list additive backfill coverage:
 * - Every tracked symbol belongs to exactly one EXCLUSIVE list (NEW /
 *   PRIMARY / SECONDARY / NEUTRAL / AVOID / HIDE). Symbols in none are
 *   "unlisted" — the sweep files them into `{uid}_NEW`.
 * - Nonexclusive lists (MONITOR, user lists) do NOT count as triage —
 *   a symbol in only a nonexclusive list is still unlisted.
 * - Strictly additive: the write payload uses arrayUnion + merge, so
 *   existing memberships can never be removed by the sweep.
 * - Membership and the symbol universe are computed across BOTH list
 *   roots (legacy `savant-trader/data/symbol-lists` + canonical
 *   `st-symbol-lists`) and both symbol roots — drift between roots
 *   can't mis-file a symbol.
 * - `{uid}_NEW` target resolution: --uid wins; an existing NEW doc is
 *   preferred (uid-scoped over bare legacy ids); a single-uid
 *   deployment mints `{uid}_NEW`; multiple uids with no NEW doc and no
 *   --uid is an error, not a guess.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNewListDoc,
  computeUnlisted,
  enabledSymbolIds,
  EXCLUSIVE_LIST_KEYS,
  exclusiveMembership,
  listKeyOf,
  NEW_LIST_KEY,
  resolveNewListTarget,
  summarizeListDocs,
} from '../../functions/src/common/st-new-list-sweep';

/** Minimal doc shape — mirrors the fields the sweep reads off a snapshot. */
function listDoc(
  id: string,
  data: { key?: string; symbols?: unknown; userId?: unknown },
) {
  return { id, data: () => data };
}

/** FieldValue stand-in that records what it was asked for. */
function fakeFieldValue() {
  const calls = { arrayUnion: [] as unknown[][], serverTimestamp: 0 };
  const api = {
    arrayUnion: (...els: unknown[]) => {
      calls.arrayUnion.push(els);
      return { __union: els };
    },
    serverTimestamp: () => {
      calls.serverTimestamp += 1;
      return '__server_ts__';
    },
  };
  return { api, calls };
}

describe('listKeyOf', () => {
  it('uses the stamped key when present', () => {
    assert.equal(listKeyOf('u1_PRIMARY', { key: 'SECONDARY' }), 'SECONDARY');
  });

  it('falls back to the bare doc id for legacy docs', () => {
    assert.equal(listKeyOf('NEW', {}), 'NEW');
  });

  it('uses the legacy name field when no key is stamped', () => {
    assert.equal(listKeyOf('NEW', { name: 'NEW' }), 'NEW');
    assert.equal(listKeyOf('watchlist-x', { name: 'PRIMARY' }), 'PRIMARY');
  });

  it('unstamped {anyone}_{EXCLUSIVE} resolves by id suffix — u1_PRIMARY without userId is still PRIMARY', () => {
    // The FE strips the viewer's {uid}_ prefix regardless of a userId
    // field; skipping this would read the doc as a user list and
    // re-file its members into NEW (dual membership).
    assert.equal(listKeyOf('u1_PRIMARY', {}), 'PRIMARY');
    assert.equal(listKeyOf('u1_AVOID', {}), 'AVOID');
  });

  it('resolves the {userId}_-suffix like the FE — unstamped u1_NEW is NEW', () => {
    assert.equal(listKeyOf('u1_NEW', { userId: 'u1' }), 'NEW');
    assert.equal(listKeyOf('u1_PRIMARY', { userId: 'u1' }), 'PRIMARY');
    // A user list resolves to its name — nonexclusive either way.
    assert.equal(listKeyOf('u1_myteam', { userId: 'u1' }), 'myteam');
  });

  it('unstamped uid-shaped docs WITHOUT userId stay full-id when the suffix is not a triage key', () => {
    // u1_myteam could be a user list — never guessed as exclusive.
    assert.equal(listKeyOf('u1_myteam', {}), 'u1_myteam');
  });
});

describe('exclusiveMembership', () => {
  it('unions symbols[] across exclusive list docs only', () => {
    const docs = [
      listDoc('u1_NEW', { key: 'NEW', symbols: ['AAPL', 'msft'] }),
      listDoc('u1_PRIMARY', { key: 'PRIMARY', symbols: ['NVDA'] }),
      listDoc('u1_MONITOR', { key: 'MONITOR', symbols: ['SPY'] }),
      listDoc('u1_mine', { symbols: ['TSLA'] }), // user list — no stamped key
    ];
    const members = exclusiveMembership(docs);
    assert.deepEqual([...members].sort(), ['AAPL', 'MSFT', 'NVDA']);
    assert.equal(members.has('SPY'), false);
    assert.equal(members.has('TSLA'), false);
  });

  it('legacy bare-id docs still count as exclusive', () => {
    const docs = [listDoc('NEW', { symbols: ['AAPL'] })];
    assert.equal(exclusiveMembership(docs).has('AAPL'), true);
  });

  it('tolerates docs with no symbols array', () => {
    const docs = [listDoc('u1_PRIMARY', { key: 'PRIMARY' })];
    assert.equal(exclusiveMembership(docs).size, 0);
  });

  it('the exclusive key set is the six triage buckets', () => {
    assert.deepEqual(
      [...EXCLUSIVE_LIST_KEYS].sort(),
      ['AVOID', 'HIDE', 'NEUTRAL', 'NEW', 'PRIMARY', 'SECONDARY'],
    );
  });
});

describe('enabledSymbolIds — the shared universe', () => {
  it('uppercases ids, drops enabled:false, counts a missing field as enabled', () => {
    const docs = [
      { id: 'aapl', data: () => ({ enabled: true }) },
      { id: 'msft', data: () => ({}) },
      { id: 'dead', data: () => ({ enabled: false }) },
    ];
    assert.deepEqual([...enabledSymbolIds(docs)].sort(), ['AAPL', 'MSFT']);
  });
});

describe('computeUnlisted', () => {
  it('returns universe symbols absent from exclusive membership, sorted', () => {
    const unlisted = computeUnlisted(
      new Set(['ZZZ', 'AAPL', 'MSFT']),
      new Set(['AAPL']),
    );
    assert.deepEqual(unlisted, ['MSFT', 'ZZZ']);
  });

  it('returns nothing when every symbol is filed', () => {
    assert.deepEqual(
      computeUnlisted(new Set(['AAPL']), new Set(['AAPL'])),
      [],
    );
  });
});

describe('resolveNewListTarget', () => {
  it('--uid always wins', () => {
    assert.equal(
      resolveNewListTarget({ uidArg: 'u9', newDocIds: ['u1_NEW'], uids: new Set(['u1']) }),
      'u9_NEW',
    );
  });

  it('throws on multiple NEW docs — ambiguous ownership is an error, not a guess', () => {
    assert.throws(
      () => resolveNewListTarget({ newDocIds: ['u1_NEW', 'u2_NEW'], uids: new Set(['u1', 'u2']) }),
      /--uid/,
    );
  });

  it('a single existing NEW doc is the target', () => {
    assert.equal(
      resolveNewListTarget({ newDocIds: ['u1_NEW'], uids: new Set(['u1']) }),
      'u1_NEW',
    );
    assert.equal(
      resolveNewListTarget({ newDocIds: ['NEW'], uids: new Set(['u1']) }),
      'NEW',
    );
  });

  it('mints {uid}_NEW when exactly one uid exists across list docs', () => {
    assert.equal(
      resolveNewListTarget({ newDocIds: [], uids: new Set(['u1']) }),
      'u1_NEW',
    );
  });

  it('throws when uids are ambiguous and no NEW doc exists', () => {
    assert.throws(
      () => resolveNewListTarget({ newDocIds: [], uids: new Set(['u1', 'u2']) }),
      /--uid/,
    );
  });
});

describe('summarizeListDocs — shared census', () => {
  it('a doc mirrored across both roots dedupes into newDocIds once', () => {
    const docs = [
      listDoc('u1_NEW', { key: 'NEW', userId: 'u1', symbols: ['AAPL'] }),
      listDoc('u1_NEW', { key: 'NEW', userId: 'u1', symbols: ['MSFT'] }),
    ];
    const { members, newDocIds, uids } = summarizeListDocs(docs);
    // Membership unions — divergent mirrors produce the superset
    // (conservative: fewer unlisted, never wrongly filed).
    assert.deepEqual([...members].sort(), ['AAPL', 'MSFT']);
    assert.deepEqual(newDocIds, ['u1_NEW']);
    assert.deepEqual([...uids], ['u1']);
  });
});

describe('buildNewListDoc — strictly additive payload', () => {
  it('on a fully-stamped doc: arrayUnion members, no meta overwrite, no createdAt', () => {
    const { api, calls } = fakeFieldValue();
    const doc = buildNewListDoc({
      fieldValue: api,
      existing: { key: 'NEW', role: 'exclusive' },
      unlisted: ['MSFT'],
      userId: 'u1',
    });
    assert.deepEqual(calls.arrayUnion, [['MSFT']]);
    assert.equal(doc['userId'], 'u1');
    assert.equal('label' in doc, false);
    assert.equal('order' in doc, false);
    assert.equal('createdAt' in doc, false);
  });

  it('on a new doc: stamps NEW meta + createdAt alongside the union', () => {
    const { api, calls } = fakeFieldValue();
    const doc = buildNewListDoc({
      fieldValue: api,
      existing: undefined,
      unlisted: ['MSFT'],
      userId: 'u1',
    });
    assert.equal(doc['key'], NEW_LIST_KEY);
    assert.equal(doc['label'], 'New symbols');
    assert.equal(doc['role'], 'exclusive');
    assert.equal(doc['createdAt'], '__server_ts__');
    assert.equal(calls.serverTimestamp >= 1, true);
  });

  it('on a {name}-era doc (exists, key/role unstamped): full meta re-stamped — key without role would un-triage members in the FE', () => {
    const { api } = fakeFieldValue();
    const doc = buildNewListDoc({
      fieldValue: api,
      existing: { name: 'NEW' },
      unlisted: ['MSFT'],
      userId: 'u1',
    });
    assert.equal(doc['key'], NEW_LIST_KEY);
    assert.equal(doc['role'], 'exclusive');
    assert.equal(doc['label'], 'New symbols');
    assert.equal('createdAt' in doc, false);
  });

  it('on a key-only half-migrated doc: role gets stamped too — meta is all-or-nothing', () => {
    const { api } = fakeFieldValue();
    const doc = buildNewListDoc({
      fieldValue: api,
      existing: { key: 'NEW' },
      unlisted: ['MSFT'],
      userId: 'u1',
    });
    assert.equal(doc['role'], 'exclusive');
    assert.equal('createdAt' in doc, false);
  });

  it('carries the union sentinel in symbols — the additive write itself', () => {
    const { api } = fakeFieldValue();
    const doc = buildNewListDoc({
      fieldValue: api,
      existing: { key: 'NEW', role: 'exclusive' },
      unlisted: ['MSFT', 'ZZZ'],
      userId: 'u1',
    });
    assert.deepEqual(doc['symbols'], { __union: ['MSFT', 'ZZZ'] });
  });

  it('omits userId entirely when unattributed — no undefined field emitted', () => {
    const { api } = fakeFieldValue();
    const doc = buildNewListDoc({
      fieldValue: api,
      existing: undefined,
      unlisted: ['MSFT'],
      userId: undefined,
    });
    assert.equal('userId' in doc, false);
  });
});
