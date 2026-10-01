import { bucketTargetWarnings, evaluateOrderGuardrails } from './order-guardrails.util';

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

describe('bucketTargetWarnings', () => {
  const bucket = { bucketName: 'Wheel', exposure: 900, targetDollars: 1000 };

  it('warns (never blocks) when a buy would push the bucket over target', () => {
    const warnings = bucketTargetWarnings(bucket, 200, 'buy');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warning');
    // Names bucket, exposure, projected, and target — AC #592.
    expect(warnings[0].message).toContain('Wheel');
    expect(warnings[0].message).toContain('900');
    expect(warnings[0].message).toContain('1,100');
    expect(warnings[0].message).toContain('1,000');
  });

  it('stays quiet when the order fits the target', () => {
    expect(bucketTargetWarnings(bucket, 100, 'buy')).toEqual([]);
  });

  it('stays quiet for sells — sells never add exposure', () => {
    expect(bucketTargetWarnings(bucket, 200, 'sell')).toEqual([]);
  });

  it('stays quiet with no bucket selected (bucket is optional)', () => {
    expect(bucketTargetWarnings(null, 5000, 'buy')).toEqual([]);
  });
});
