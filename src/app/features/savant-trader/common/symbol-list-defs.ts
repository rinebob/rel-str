/**
 * Registry model for Savant Trader symbol lists (Topic #465, Thread #492).
 *
 * Every list — system or user-created — is a doc in the
 * `savant-trader/data/symbol-lists` collection (`Collection.ST_SYMBOL_LISTS`)
 * carrying its own metadata. `key` is the immutable machine identifier;
 * `label` is renameable cosmetics; `role` drives exclusivity behavior.
 *
 * SYSTEM_LIST_DEFS is the seed/migration template ONLY — it stamps metadata
 * when materializing or rekeying system docs. Read paths never consult it.
 */
import type { Timestamp } from '@angular/fire/firestore';

/** Exclusivity contract for a list. */
export type SymbolListRole = 'exclusive' | 'nonexclusive';

/** A single symbol list as a registry document. */
export interface SymbolListDef {
  /** Immutable machine id — reserved for system lists, generated slug for user lists. */
  key: string;
  /** Renameable display text. Never a lookup key. */
  label: string;
  /** Sort position — system block 0..5, user lists appended after. */
  order: number;
  role: SymbolListRole;
  /** Excluded from filter dropdowns when true. */
  hidden: boolean;
  symbols: string[];
  userId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** Registry doc id for a user's list: `{userId}_{key}`. */
export function symbolListDocId(userId: string, key: string): string {
  return `${userId}_${key}`;
}

/** Reserved system keys in display order. */
export const SYSTEM_LIST_KEYS = {
  PRIMARY: 'PRIMARY',
  SECONDARY: 'SECONDARY',
  NEUTRAL: 'NEUTRAL',
  AVOID: 'AVOID',
  HIDE: 'HIDE',
  MONITOR: 'MONITOR',
} as const;

export type SystemListKey = (typeof SYSTEM_LIST_KEYS)[keyof typeof SYSTEM_LIST_KEYS];

/** Legacy Firestore name for the Monitor list — migrated to MONITOR. */
export const LEGACY_MONITOR_LIST_NAME = 'PAST_SIGNALS';

/**
 * Every pre-registry bare-name doc id that could hold membership: the six
 * system names plus the legacy Monitor name. Probed directly on first
 * `watchLists$` emission because docs written without a `userId` field are
 * invisible to the filtered collection query.
 */
export const ALL_LEGACY_LIST_IDS: readonly string[] = [
  'PRIMARY', 'SECONDARY', 'NEUTRAL', 'AVOID', 'HIDE', 'MONITOR',
  LEGACY_MONITOR_LIST_NAME,
];

/** Synthetic `order` assigned to unknown legacy lists on migration —
 *  lands them after the 0..5 system block. */
export const USER_LIST_ORDER_START = 100;

/** Seed template — metadata stamped onto system docs at materialization. */
export const SYSTEM_LIST_DEFS: ReadonlyArray<
  Pick<SymbolListDef, 'key' | 'label' | 'order' | 'role' | 'hidden'>
> = [
  { key: SYSTEM_LIST_KEYS.PRIMARY,   label: 'Primary',   order: 0, role: 'exclusive',    hidden: false },
  { key: SYSTEM_LIST_KEYS.SECONDARY, label: 'Secondary', order: 1, role: 'exclusive',    hidden: false },
  { key: SYSTEM_LIST_KEYS.NEUTRAL,   label: 'Neutral',   order: 2, role: 'exclusive',    hidden: false },
  { key: SYSTEM_LIST_KEYS.AVOID,     label: 'Avoid',     order: 3, role: 'exclusive',    hidden: false },
  { key: SYSTEM_LIST_KEYS.HIDE,      label: 'Hidden',    order: 4, role: 'exclusive',    hidden: false },
  { key: SYSTEM_LIST_KEYS.MONITOR,   label: 'Monitor',   order: 5, role: 'nonexclusive', hidden: false },
];

const SYSTEM_DEF_BY_KEY = new Map(SYSTEM_LIST_DEFS.map((d) => [d.key, d]));

/** Seed template for a system key, or null for user/unknown keys. */
export function systemListDef(key: string) {
  return SYSTEM_DEF_BY_KEY.get(key) ?? null;
}

/**
 * Resolve the registry key for a pre-registry doc name/id. PAST_SIGNALS maps
 * to MONITOR; anything else passes through (system names map to themselves).
 */
export function legacyListKey(name: string): string {
  return name === LEGACY_MONITOR_LIST_NAME ? SYSTEM_LIST_KEYS.MONITOR : name;
}
