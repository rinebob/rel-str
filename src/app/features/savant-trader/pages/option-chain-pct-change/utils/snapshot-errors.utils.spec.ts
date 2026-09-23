import { describeSnapshotError } from './snapshot-errors.utils';

describe('describeSnapshotError', () => {
  it('renders a friendly message for OPTIONS_NOT_ENABLED (partner code in message)', () => {
    const err = new Error('partner 404 code=OPTIONS_NOT_ENABLED: nope');
    (err as unknown as { code: string }).code = 'functions/failed-precondition';
    expect(describeSnapshotError(err, 'XYZ')).toBe(
      'Options analysis is not available for XYZ',
    );
  });

  it('renders the friendly message on failed-precondition alone', () => {
    const err = new Error('partner 404: whatever');
    (err as unknown as { code: string }).code = 'functions/failed-precondition';
    expect(describeSnapshotError(err, 'XYZ')).toBe(
      'Options analysis is not available for XYZ',
    );
  });

  it('renders a JSON-embedded partner code too', () => {
    const err = new Error('upstream 404: {"ok":false,"code":"OPTIONS_NOT_ENABLED"}');
    (err as unknown as { code: string }).code = 'functions/not-found';
    expect(describeSnapshotError(err, 'XYZ')).toBe(
      'Options analysis is not available for XYZ',
    );
  });

  it('keeps callable code + detail for other errors', () => {
    const err = new Error('upstream 502: boom');
    (err as unknown as { code: string }).code = 'functions/unavailable';
    expect(describeSnapshotError(err, 'XYZ')).toBe('unavailable: upstream 502: boom');
  });

  it('truncates long messages and tolerates non-Error input', () => {
    const long = 'x'.repeat(200);
    expect(describeSnapshotError(new Error(long), 'XYZ')).toBe(`${'x'.repeat(120)}…`);
    expect(describeSnapshotError('plain string', 'XYZ')).toBe('plain string');
  });
});
