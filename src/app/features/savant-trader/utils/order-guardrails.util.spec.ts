import { evaluateOrderGuardrails } from './order-guardrails.util';

describe('evaluateOrderGuardrails', () => {
  it('warns on policy limits and blocks only insufficient cash', () => {
    const warnings = evaluateOrderGuardrails({
      currentExposure: 7900,
      currentUnits: 199,
      availableCash: 50,
      allocationCap: 8000,
      maxUnits: 200,
    }, 150, 1.5, 'buy');

    expect(warnings.map((warning) => warning.severity)).toEqual(['warning', 'warning', 'block']);
  });

  it('produces no buy-side cash/allocation warnings for sell orders', () => {
    const warnings = evaluateOrderGuardrails({
      currentExposure: 1000,
      currentUnits: 10,
      availableCash: 0,
      allocationCap: 1000,
      maxUnits: 10,
    }, 100, 1, 'sell');

    expect(warnings).toEqual([]);
  });

  it('warns when a sell would exceed held units or exposure', () => {
    const warnings = evaluateOrderGuardrails({
      currentExposure: 100,
      currentUnits: 1,
      availableCash: 0,
      allocationCap: 100,
      maxUnits: 1,
    }, 150, 1.5, 'sell');

    expect(warnings.map((warning) => warning.severity)).toEqual(['warning', 'warning']);
  });
});
