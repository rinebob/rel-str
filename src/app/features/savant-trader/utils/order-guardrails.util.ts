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
