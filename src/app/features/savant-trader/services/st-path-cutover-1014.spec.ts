/**
 * #1014 — FE service path re-points onto the canonical st-* roots.
 *
 * Pins the `Collection` enum boundary: members whose roots were retired by
 * this cutover must be gone (a re-add or a leftover member means a service
 * is still compiling against a dead path), and members still consumed by
 * tasks #1017–#1019 stay pinned to their legacy spellings so this cutover
 * can't silently move data those tasks haven't re-pointed yet.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

import { Collection } from '../../../core/common/constants';
import {
  ST_ORDER_TICKETS_ROOT,
  ST_SYMBOL_LISTS_ROOT,
  ST_STRATEGY_INSTANCES_ROOT,
  ST_BACKTEST_RUNS_ROOT,
  ST_BACKTEST_PERMUTATIONS_ROOT,
  ST_CONFIG_ROOT,
  ST_RUNS_ROOT,
  ST_SYMBOLS_ROOT,
  StPortfolioKind,
  stPortfolioItemsPath,
  stConfigDocPath,
} from '@st/collections';

describe('#1014 FE st-* path cutover', () => {
  it('retired Collection members are removed', () => {
    for (const member of [
      'ST_SYMBOL_LISTS',
      'ST_SYMBOL_META',
      'ST_TRADING_CONFIG',
      'PAPER_TRADING_INSTANCES',
      // #1015 — order-ticket.service re-pointed to st-order-tickets.
      'ST_ORDER_INTENTS',
      // #1016 — review-list removed entirely (service, constant, flag UX).
      'ST_REVIEW_LIST',
      // #1017 — occurrence-decisions removed entirely (service, store,
      // constant, ACR workflow); ticket existence is the decision.
      'ST_OCCURRENCE_DECISIONS',
      // #1019 — signal readers cut to st-signals; the legacy symbols parent
      // (run-ids/signal-history host) is fully retired.
      'ST_SYMBOLS',
      // #1159 — run doc reads moved to st-runs.
      'ST_RUNS',
    ]) {
      expect(member in Collection).toBe(false);
    }
  });

  it('canonical helpers resolve to the deployed st-* roots', () => {
    expect(ST_ORDER_TICKETS_ROOT).toBe('st-order-tickets');
    expect(ST_SYMBOL_LISTS_ROOT).toBe('st-symbol-lists');
    expect(ST_STRATEGY_INSTANCES_ROOT).toBe('st-strategy-instances');
    expect(ST_BACKTEST_RUNS_ROOT).toBe('st-backtest-runs');
    expect(ST_BACKTEST_PERMUTATIONS_ROOT).toBe('st-backtest-permutations');
    expect(ST_CONFIG_ROOT).toBe('st-config');
    expect(ST_RUNS_ROOT).toBe('st-runs');
    expect(ST_SYMBOLS_ROOT).toBe('st-symbols');
    expect(stPortfolioItemsPath(StPortfolioKind.BUCKET)).toBe(
      'st-portfolio/buckets/items',
    );
    expect(stPortfolioItemsPath(StPortfolioKind.ATTRIBUTION)).toBe(
      'st-portfolio/attributions/items',
    );
    expect(stConfigDocPath('user-1')).toBe('st-config/user-1');
  });

  it('no legacy Firestore path literals remain in src/app outside pinned constants', () => {
    // TEST doc: "no remaining savant-trader/ references post-cutover
    // (grep-based spec)". Scans quoted string literals only — plain-text
    // doc comments and module specifiers ('./x', '../x', '@x/…') can't
    // match the quote-prefix requirement.
    const APP_ROOT = join(__dirname, '..', '..', '..');
    const ALLOWLIST = new Set([
      // Retained members pinned above (none for savant-trader/data/ post-#1019,
      // but the constants file itself may document retired spellings).
      'core/common/constants.ts',
      // This spec's own expectations.
      'features/savant-trader/services/st-path-cutover-1014.spec.ts',
    ]);
    // Retired-path spellings — 'savant-trader/data/' distinguishes the
    // Firestore namespace from Angular route paths ('savant-trader/x'),
    // 'portfolio/{buckets,attributions}' from the 'portfolio/allocation'
    // route, and 'backtest-{runs,permutations}' are the flat root names.
    const LEGACY_LITERAL =
      /['"`](savant-trader\/data\/|paper-trading\/|portfolio\/(buckets|attributions)|backtest-(runs|permutations))/;
    const COMMENT_LINE = /^\s*(\*|\/\/)/;
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith('.ts')) {
          const rel = relative(APP_ROOT, path).replace(/\\/g, '/');
          if (ALLOWLIST.has(rel)) continue;
          readFileSync(path, 'utf8')
            .split('\n')
            .forEach((line, i) => {
              if (!COMMENT_LINE.test(line) && LEGACY_LITERAL.test(line)) {
                hits.push(`${rel}:${i + 1}: ${line.trim()}`);
              }
            });
        }
      }
    };
    walk(APP_ROOT);
    expect(hits).toEqual([]);
  });
});
