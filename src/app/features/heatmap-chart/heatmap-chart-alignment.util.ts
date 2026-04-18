import type { PriceBar, HeatmapCell, AlignmentMetrics, CellAlignment } from './heatmap-chart.types';

/**
 * Calculate alignment metrics for mapping chart bars to heatmap cells.
 * Creates bidirectional date-to-index mappings for efficient lookups.
 */
export function calculateAlignmentMetrics(bars: PriceBar[]): AlignmentMetrics {
  const dateToIndex = new Map<string, number>();
  const indexToDate = new Map<number, string>();

  bars.forEach((bar, index) => {
    dateToIndex.set(bar.date, index);
    indexToDate.set(index, bar.date);
  });

  return {
    barWidth: 1,
    totalBars: bars.length,
    dateToIndex,
    indexToDate,
  };
}

/**
 * Calculate cell alignment for a heatmap cell relative to chart bars.
 * For DAILY cells: 1:1 mapping with chart bars.
 * For WEEKLY/MONTHLY cells: span multiple bars based on date range.
 */
export function calculateCellAlignment(
  cell: HeatmapCell,
  metrics: AlignmentMetrics,
  nextCellDate?: string
): CellAlignment | null {
  const startIndex = metrics.dateToIndex.get(cell.date);
  if (startIndex === undefined) {
    return null;
  }

  let endIndex = startIndex;

  if (nextCellDate) {
    const nextIndex = metrics.dateToIndex.get(nextCellDate);
    if (nextIndex !== undefined) {
      endIndex = nextIndex - 1;
    } else {
      endIndex = metrics.totalBars - 1;
    }
  }

  const spanBars = endIndex - startIndex + 1;
  const left = startIndex * metrics.barWidth;
  const width = spanBars * metrics.barWidth;

  return {
    left,
    width,
    startIndex,
    endIndex,
  };
}

/**
 * Calculate alignments for all cells in a heatmap row.
 */
export function calculateRowAlignments(
  cells: HeatmapCell[],
  metrics: AlignmentMetrics
): Map<string, CellAlignment> {
  const alignments = new Map<string, CellAlignment>();

  cells.forEach((cell, index) => {
    const nextCellDate = index < cells.length - 1 ? cells[index + 1].date : undefined;
    const alignment = calculateCellAlignment(cell, metrics, nextCellDate);
    
    if (alignment) {
      alignments.set(cell.date, alignment);
    }
  });

  return alignments;
}

/**
 * Get the span in days for a weekly or monthly cell.
 * Used for visual representation of cell width.
 */
export function getCellSpanDays(
  cellDate: string,
  nextCellDate: string | undefined,
  metrics: AlignmentMetrics
): number {
  const startIndex = metrics.dateToIndex.get(cellDate);
  if (startIndex === undefined) return 1;

  if (!nextCellDate) {
    return metrics.totalBars - startIndex;
  }

  const nextIndex = metrics.dateToIndex.get(nextCellDate);
  if (nextIndex === undefined) {
    return metrics.totalBars - startIndex;
  }

  return nextIndex - startIndex;
}
