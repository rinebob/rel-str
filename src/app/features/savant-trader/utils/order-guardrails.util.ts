import { wouldExceedTarget } from '@portfolio-allocation/utils';

export interface GuardrailContext {
  currentExposure: number;
  currentUnits: number;
  availableCash: number;
  allocationCap: number;
  maxUnits: number;
}

export interface GuardrailWarning {
  message: string;
  severity: 'warning' | 'block';
}

export function evaluateOrderGuardrails(
  context: GuardrailContext,
  orderCost: number,
  orderUnits: number,
  side: 'buy' | 'sell' = 'buy',
): GuardrailWarning[] {
  const warnings: GuardrailWarning[] = [];

  if (side === 'buy') {
    const afterUnits = context.currentUnits + orderUnits;
    if (afterUnits > context.maxUnits) {
      warnings.push({
        severity: 'warning',
        message: `Exceeds max units: current ${context.currentUnits}, after ${afterUnits.toFixed(2)}, max ${context.maxUnits}`,
      });
    }

    const afterExposure = context.currentExposure + orderCost;
    if (afterExposure > context.allocationCap) {
      warnings.push({
        severity: 'warning',
        message: `Exceeds max allocation: current $${context.currentExposure.toFixed(0)}, after $${afterExposure.toFixed(0)}, cap $${context.allocationCap.toFixed(0)}`,
      });
    }

    if (orderCost > context.availableCash) {
      warnings.push({
        severity: 'block',
        message: `Insufficient cash: available $${context.availableCash.toFixed(0)}, required $${orderCost.toFixed(0)}`,
      });
    }
  } else {
    const afterUnits = context.currentUnits - orderUnits;
    if (afterUnits < 0) {
      warnings.push({
        severity: 'warning',
        message: `Sells more units than held: current ${context.currentUnits}, after ${afterUnits.toFixed(2)}`,
      });
    }

    const afterExposure = context.currentExposure - orderCost;
    if (afterExposure < 0) {
      warnings.push({
        severity: 'warning',
        message: `Sells more exposure than held: current $${context.currentExposure.toFixed(0)}, after $${afterExposure.toFixed(0)}`,
      });
    }
  }

  return warnings;
}

/** The bucket the order is headed for, when one is selected. */
export interface BucketTargetContext {
  bucketName: string;
  /** Current deployed dollars in the bucket. */
  exposure: number;
  targetDollars: number;
}

/** Bucket over-target warning — warn, NEVER block (bucket assignment is
 *  optional and advisory; PRD/IMPL: getting trades placed beats clean
 *  allocation). Sells can't exceed a target — they reduce exposure. */
export function bucketTargetWarnings(
  bucket: BucketTargetContext | null,
  orderCost: number,
  side: 'buy' | 'sell',
): GuardrailWarning[] {
  if (!bucket || side !== 'buy') return [];
  if (!wouldExceedTarget(bucket.exposure, orderCost, bucket.targetDollars)) return [];
  const projected = bucket.exposure + orderCost;
  const d = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return [{
    severity: 'warning',
    message: `Bucket '${bucket.bucketName}' over target: exposure ${d(bucket.exposure)} + order ${d(orderCost)} = ${d(projected)}, target ${d(bucket.targetDollars)}`,
  }];
}
