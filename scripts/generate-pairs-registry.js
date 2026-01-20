/*
 * Generate static curated pairs registry for MVP.
 *
 * Inputs:
 *   - src/assets/holdings/bulk-import.enriched_spy-qqq.json
 *   - src/assets/holdings/bulk-import.enriched_XL-non-spy-qqq.json
 *
 * Output:
 *   - src/assets/holdings/pairs-registry.mvp.json
 */

// # Reason: use plain Node.js script alongside existing JS scripts in /scripts

const fs = require('node:fs');
const path = require('node:path');

/**
 * Sector ETF baselines included in MVP universe.
 * Adjust this list if the sector coverage changes.
 * @type {Set<string>}
 */
const SECTOR_ETFS = new Set([
  'XLB',
  'XLC',
  'XLE',
  'XLF',
  'XLI',
  'XLK',
  'XLP',
  'XLU',
  'XLV',
  'XLY',
  'XME',
  'XSD',
]);

/**
 * Primary broad-market baselines for MVP.
 * @type {string[]}
 */
const PRIMARY_BASELINES = ['SPY', 'QQQ'];

/**
 * Load JSON from a relative path.
 * @param {string} relPath
 * @returns {any[]}
 */
function loadJsonArray(relPath) {
  const abs = path.join(__dirname, '..', relPath);
  const raw = fs.readFileSync(abs, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected array JSON at ${relPath}`);
  }
  return parsed;
}

/**
 * Normalize a symbol/ETF code.
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normSym(value) {
  return (value || '').trim().toUpperCase();
}

/**
 * Build the curated MVP pairs set from bulk-import holdings.
 * @returns {Set<string>} Set of pair IDs in the form BASELINE-TARGET
 */
function buildPairs() {
  const spyQqqRows = loadJsonArray('src/assets/holdings/bulk-import.enriched_spy-qqq.json');
  const xlOnlyRows = loadJsonArray('src/assets/holdings/bulk-import.enriched_XL-non-spy-qqq.json');

  const rows = [...spyQqqRows, ...xlOnlyRows];
  const pairSet = new Set();

  for (const row of rows) {
    const symbol = normSym(row.symbol);
    if (!symbol || symbol === '-') {
      continue; // skip placeholders / cash buckets
    }

    const etfs = Array.isArray(row.etfs)
      ? row.etfs.map(normSym).filter(Boolean)
      : [];

    // 1) SPY vs constituents
    if (etfs.includes('SPY')) {
      pairSet.add(`SPY-${symbol}`);
    }

    // 2) QQQ vs constituents
    if (etfs.includes('QQQ')) {
      pairSet.add(`QQQ-${symbol}`);
    }

    // 5) XL* ETFs vs constituents
    for (const e of etfs) {
      if (SECTOR_ETFS.has(e)) {
        pairSet.add(`${e}-${symbol}`);
      }
    }
  }

  // 3 & 4) SPY/QQQ vs sector ETFs themselves
  for (const x of SECTOR_ETFS) {
    pairSet.add(`SPY-${x}`);
    pairSet.add(`QQQ-${x}`);
  }

  return pairSet;
}

/**
 * Write the pairs-registry.mvp.json file.
 */
function writeRegistry() {
  const pairs = buildPairs();

  const baselines = Array.from(
    new Set([...PRIMARY_BASELINES, ...SECTOR_ETFS])
  ).sort();

  const pairsArray = Array.from(pairs)
    .sort()
    .map((id) => {
      const [baseline, ...rest] = id.split('-');
      return {
        baseline,
        target: rest.join('-'),
      };
    });

  const output = {
    version: new Date().toISOString().slice(0, 10),
    baselines,
    pairs: pairsArray,
  };

  const outPath = path.join(
    __dirname,
    '..',
    'src',
    'assets',
    'holdings',
    'pairs-registry.mvp.json',
  );

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${pairsArray.length} pairs to ${outPath}`);
}

writeRegistry();
