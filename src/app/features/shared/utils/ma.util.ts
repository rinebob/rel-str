import type { CandleWithRSColor, MaConfig, MaSeriesPoint } from '../types/rs.interfaces';
import { MaType } from '../types/rs.interfaces';

/**
 * Calculate a moving-average series for a price chart based on close prices.
 */
export function calculateMaSeriesForPrice(
    config: MaConfig,
    priceSeries: CandleWithRSColor[],
): MaSeriesPoint[] {
    if (!priceSeries?.length || config.length <= 0) {
        return [];
    }

    const closes: number[] = priceSeries.map((bar) => bar.close);
    const dates: Date[] = priceSeries.map((bar) => bar.x instanceof Date ? bar.x : new Date(bar.x));

    let values: Array<number | null> = [];
    switch (config.type) {
        case MaType.EMA:
            values = calculateEma(closes, config.length);
            break;
        case MaType.SMA:
            values = calculateSma(closes, config.length);
            break;
        case MaType.WMA:
            values = calculateWma(closes, config.length);
            break;
        default:
            values = calculateEma(closes, config.length);
            break;
    }

    return dates.map<MaSeriesPoint>((x, index) => ({
        x,
        y: values[index] ?? null,
    }));
}

function calculateSma(values: number[], length: number): Array<number | null> {
    const result: Array<number | null> = new Array(values.length).fill(null);
    if (length <= 0 || values.length < length) {
        return result;
    }

    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
        sum += values[i];
        if (i >= length) {
            sum -= values[i - length];
        }
        if (i >= length - 1) {
            result[i] = sum / length;
        }
    }

    return result;
}

/**
 * calculateEmaSeriesForValues
 *
 * Generic EMA helper over a numeric series that may contain nulls. Leading
 * positions where insufficient non-null samples exist remain null; subsequent
 * values are aligned 1:1 with the input array length.
 */
export function calculateEmaSeriesForValues(values: Array<number | null>, length: number): Array<number | null> {
    if (!Array.isArray(values) || values.length === 0 || length <= 0) {
        return new Array(values?.length ?? 0).fill(null);
    }

    // Replace nulls with the last seen non-null value for EMA math while keeping
    // nulls in the output for callers that want to treat missing samples
    // distinctly (e.g., for sorting).
    const numeric: number[] = [];
    let lastValue: number | null = null;
    for (let i = 0; i < values.length; i += 1) {
        const v = values[i];
        if (v == null || !Number.isFinite(v)) {
            if (lastValue == null) {
                // Seed with zero until we see a real value; output will still be null
                // for these leading positions.
                numeric.push(0);
            } else {
                numeric.push(lastValue);
            }
        } else {
            numeric.push(v);
            lastValue = v;
        }
    }

    const emaCore = calculateEma(numeric, length);
    const out: Array<number | null> = new Array(values.length).fill(null);

    for (let i = 0; i < values.length; i += 1) {
        if (values[i] == null) {
            out[i] = null;
        } else {
            out[i] = emaCore[i];
        }
    }

    return out;
}

function calculateEma(values: number[], length: number): Array<number | null> {
    const result: Array<number | null> = new Array(values.length).fill(null);
    if (length <= 0 || values.length < length) {
        return result;
    }

    const k = 2 / (length + 1);
    let prevEma: number | null = null;

    for (let i = 0; i < values.length; i += 1) {
        const value = values[i];
        if (i === length - 1) {
            // seed EMA with SMA of first window
            let sum = 0;
            for (let j = 0; j < length; j += 1) {
                sum += values[j];
            }
            prevEma = sum / length;
            result[i] = prevEma;
        } else if (i >= length) {
            prevEma = (value - (prevEma as number)) * k + (prevEma as number);
            result[i] = prevEma;
        }
    }

    return result;
}

function calculateWma(values: number[], length: number): Array<number | null> {
    const result: Array<number | null> = new Array(values.length).fill(null);
    if (length <= 0 || values.length < length) {
        return result;
    }

    const denominator = (length * (length + 1)) / 2;

    for (let i = length - 1; i < values.length; i += 1) {
        let weightedSum = 0;
        for (let j = 0; j < length; j += 1) {
            const weight = j + 1;
            weightedSum += values[i - (length - 1) + j] * weight;
        }
        result[i] = weightedSum / denominator;
    }

    return result;
}
