/**
 * Registry snapshot resolution + lazy migration for SymbolListService —
 * extracted to keep the service under the file-size guideline.
 *
 * Pure-ish Firestore helpers: they take the Firestore instance and act on
 * refs/batches; no injection context needed (they're invoked inside the
 * service's stream, which already provides one where required).
 */
import {
  Firestore,
  doc,
  writeBatch,
  serverTimestamp,
  DocumentData,
} from '@angular/fire/firestore';

import { Collection } from '../../../core/common/constants';
import {
  SymbolListDef,
  symbolListDocId,
  systemListDef,
  legacyListKey,
  USER_LIST_ORDER_START,
} from '../common/symbol-list-defs';

/** Stable catalog ordering — by `order` field. */
const byOrder = (a: SymbolListDef, b: SymbolListDef) => a.order - b.order;

/** Convert a registry doc's data into the typed def shape. */
export function toDef(data: DocumentData): SymbolListDef {
  const key = String(data['key']);
  const role = data['role'] === 'exclusive' ? 'exclusive' : 'nonexclusive';
  return {
    key,
    label: data['label'] ?? key,
    order: typeof data['order'] === 'number' ? data['order'] : 0,
    role,
    hidden: data['hidden'] === true,
    symbols: Array.isArray(data['symbols']) ? (data['symbols'] as string[]) : [],
    userId: data['userId'],
    createdAt: data['createdAt'],
    updatedAt: data['updatedAt'],
  };
}

/**
 * Split the snapshot into registry docs and legacy docs; when legacy docs
 * exist, batch-rekey them and emit the merged def view. On batch failure
 * emit the best-effort view (docs-as-defs) — reads stay correct and the
 * migration retries on the next emission.
 */
export async function resolveSnapshot(
  firestore: Firestore,
  userId: string,
  docs: { id: string; data: DocumentData }[],
): Promise<SymbolListDef[]> {
  const prefix = `${userId}_`;
  const registry = new Map<string, SymbolListDef>();
  const legacy: typeof docs = [];

  for (const d of docs) {
    const isRegistry = d.id.startsWith(prefix) && d.data['key'];
    if (isRegistry) registry.set(d.data['key'], toDef(d.data));
    else legacy.push(d);
  }
  if (legacy.length === 0) return [...registry.values()].sort(byOrder);

  const out = new Map(registry);
  const batch = writeBatch(firestore);
  // Deterministic order for synthetic ordering of unknown lists.
  legacy.sort((a, b) => a.id.localeCompare(b.id));
  let userOrder = USER_LIST_ORDER_START;
  for (const d of legacy) {
    // Name wins; a prefixed-but-unstamped id falls back to its suffix.
    const name =
      (d.data['name'] as string) ??
      (d.id.startsWith(prefix) ? d.id.slice(prefix.length) : d.id);
    const key = legacyListKey(name);
    const template = systemListDef(key);
    // Merge into the accumulated view — covers both an existing registry
    // doc and a previous legacy doc that resolved to the same key.
    const existing = out.get(key);
    const symbols = [
      ...new Set([...(existing?.symbols ?? []), ...((d.data['symbols'] as string[]) ?? [])]),
    ];
    const def: SymbolListDef = {
      ...(existing ?? template ?? {
        key, label: name, order: userOrder++, role: 'nonexclusive', hidden: false,
      }),
      symbols,
      userId,
      createdAt: existing?.createdAt ?? d.data['createdAt'],
    };
    batch.set(
      doc(firestore, Collection.ST_SYMBOL_LISTS, symbolListDocId(userId, key)),
      {
        key: def.key,
        label: def.label,
        order: def.order,
        role: def.role,
        hidden: def.hidden,
        symbols,
        userId,
        createdAt: def.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    // A prefixed-but-unstamped doc rekeys to itself — delete would erase it.
    if (d.id !== symbolListDocId(userId, key)) {
      batch.delete(doc(firestore, Collection.ST_SYMBOL_LISTS, d.id));
    }
    out.set(key, def);
  }

  try {
    await batch.commit();
  } catch (err) {
    console.error('[SymbolListService] registry doc migration failed', err);
    return fallbackDefs(userId, docs);
  }
  return [...out.values()].sort(byOrder);
}

/**
 * Best-effort defs straight from the snapshot when the migration batch
 * fails — legacy docs map name→key, same-key docs merge, nothing written.
 */
export function fallbackDefs(
  userId: string,
  docs: { id: string; data: DocumentData }[],
): SymbolListDef[] {
  const prefix = `${userId}_`;
  const out = new Map<string, SymbolListDef>();
  const sorted = [...docs].sort((a, b) => a.id.localeCompare(b.id));
  let userOrder = USER_LIST_ORDER_START;
  for (const d of sorted) {
    const isRegistry = d.id.startsWith(prefix) && d.data['key'];
    if (isRegistry) {
      const def = toDef(d.data);
      const prev = out.get(def.key);
      out.set(def.key, {
        ...def,
        symbols: [...new Set([...(prev?.symbols ?? []), ...def.symbols])],
      });
      continue;
    }
    const name =
      (d.data['name'] as string) ??
      (d.id.startsWith(prefix) ? d.id.slice(prefix.length) : d.id);
    const key = legacyListKey(name);
    const template = systemListDef(key);
    const symbols = (d.data['symbols'] as string[]) ?? [];
    const prev = out.get(key);
    out.set(key, {
      ...(prev ?? template ?? {
        key, label: name, order: userOrder++, role: 'nonexclusive', hidden: false,
      }),
      symbols: [...new Set([...(prev?.symbols ?? []), ...symbols])],
      userId,
      createdAt: prev?.createdAt ?? d.data['createdAt'],
    });
  }
  return [...out.values()].sort(byOrder);
}
