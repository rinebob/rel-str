import { selectRsForDay } from '../../functions/src/archive';
import { RsPhase } from '../../functions/src/types/partner';

describe('selectRsForDay (fixed rubric)', () => {
  const today = '2025-01-15';
  const hist = '2025-01-14';

  it('Historical: POST only; ignores PRE even if present', () => {
    const row = { day: hist, post: { rs: 1.2 }, pre: { rs: 0.9 } };
    const picked = selectRsForDay(row, hist, today);
    expect(picked).toEqual({ value: 1.2, phase: RsPhase.POST });
  });

  it('Historical: with only PRE present yields no value', () => {
    const row = { day: hist, pre: { rs: 0.9 } };
    const picked = selectRsForDay(row, hist, today);
    expect(picked.value).toBeUndefined();
    expect(picked.phase).toBeUndefined();
  });

  it('Today: prefers POST if present', () => {
    const row = { day: today, pre: { rs: 0.95 }, post: { rs: 1.05 } };
    const picked = selectRsForDay(row, today, today);
    expect(picked).toEqual({ value: 1.05, phase: RsPhase.POST });
  });

  it('Today: falls back to PRE if POST missing', () => {
    const row = { day: today, pre: { rs: 0.98 } };
    const picked = selectRsForDay(row, today, today);
    expect(picked).toEqual({ value: 0.98, phase: RsPhase.PRE });
  });
});
