import type { ContractCatalogEntry } from '@options-contract/contracts';

export interface LengthGroup {
  name: string;
  options: { value: string; label: string }[];
}

const LENGTH_LABELS: Record<string, string> = {
  '1d': '1 Day', '3d': '3 Days', '5d': '5 Days', '7d': '7 Days',
  '14d': '14 Days', '21d': '21 Days', '1mo': '1 Month', '1.5mo': '1.5 Months',
  '2mo': '2 Months', '3mo': '3 Months', '4mo': '4 Months', '6mo': '6 Months',
  '9mo': '9 Months', '1yr': '1 Year', '2yr': '2 Years', '3yr': '3 Years',
};

const SHORT_BUCKETS = ['1d', '3d', '5d', '7d', '14d', '21d'];
const MEDIUM_BUCKETS = ['1mo', '1.5mo', '2mo', '3mo', '4mo'];

export function getLengthLabel(bucket: string): string {
  return LENGTH_LABELS[bucket] ?? bucket;
}

export function groupLengthBuckets(buckets: string[]): LengthGroup[] {
  const groups: LengthGroup[] = [
    { name: 'Short', options: [] },
    { name: 'Medium', options: [] },
    { name: 'Long', options: [] },
  ];

  for (const bucket of buckets) {
    const label = LENGTH_LABELS[bucket] ?? bucket;
    const option = { value: bucket, label };
    if (SHORT_BUCKETS.includes(bucket)) groups[0].options.push(option);
    else if (MEDIUM_BUCKETS.includes(bucket)) groups[1].options.push(option);
    else groups[2].options.push(option);
  }

  return groups.filter((g) => g.options.length > 0);
}

export interface CatalogRow extends ContractCatalogEntry {
  latestDelta: number | null;
  latestIV: number | null;
  latestVolume: number | null;
  latestOI: number | null;
  latestMark: number | null;
  coverage: number | null;
}

export function computeCoverage(entry: ContractCatalogEntry): number | null {
  if (!entry.expectedObservationCount) return null;
  return entry.observationCount / entry.expectedObservationCount;
}

export function toCatalogRow(entry: ContractCatalogEntry): CatalogRow {
  return {
    ...entry,
    latestDelta: entry.latest?.delta ? Number(entry.latest.delta) : null,
    latestIV: entry.latest?.iv ? Number(entry.latest.iv) : null,
    latestVolume: entry.latest?.volume ? Number(entry.latest.volume) : null,
    latestOI: entry.latest?.openInterest ? Number(entry.latest.openInterest) : null,
    latestMark: entry.latest?.mark ? Number(entry.latest.mark) : null,
    coverage: computeCoverage(entry),
  };
}
