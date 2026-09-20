import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv();

// Polyfill fetch and Response for Node.js (needed by Firebase Auth module-level initialization)
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = (() => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') } as Response)) as typeof fetch;
}
if (typeof globalThis.Response === 'undefined') {
  class ResponsePolyfill {
    ok = true;
    status = 200;
    constructor(private body: any = {}, private init: any = {}) {}
    json() { return Promise.resolve(typeof this.body === 'string' ? JSON.parse(this.body) : this.body); }
    text() { return Promise.resolve(typeof this.body === 'string' ? this.body : JSON.stringify(this.body)); }
  }
  globalThis.Response = ResponsePolyfill as any;
}

// Jasmine compatibility shim — jest-preset-angular 17.0.0 transformer doesn't
// expose `jasmine` as a global, but 22 spec files across the repo use
// `jasmine.createSpy()` and `jasmine.createSpyObj()`. Map the common jasmine
// spy APIs to their jest equivalents.
if (typeof (globalThis as any).jasmine === 'undefined') {
  // Jasmine CallTracker-compatible call record. Jest 30 matchers read
  // `fn.mock.calls` directly — this `.calls` surface exists for spec code
  // that calls jasmine's API (`spy.calls.mostRecent().args` etc.). Records
  // use jasmine's CallData shape: `{args, object, returnValue, invocationOrder}`.
  // `invocationOrder` is per-spy, not global like real jasmine.
  const toCallData = (fn: jest.Mock, i: number) => ({
    args: fn.mock.calls[i] ?? [],
    object: undefined,
    returnValue: fn.mock.results?.[i]?.value,
    invocationOrder: i,
  });
  const wrapSpy = (fn: jest.Mock): any => {
    const spy: any = fn;
    spy.and = {
      returnValue: (val: any) => { fn.mockReturnValue(val); return spy; },
      callFake: (impl: (...args: any[]) => any) => { fn.mockImplementation(impl); return spy; },
      // No original implementation exists on a jest.fn — callThrough is a
      // semantic no-op here (same as stub); kept only so jasmine call sites compile.
      callThrough: () => { fn.mockImplementation(undefined as any); return spy; },
      throwError: (err: any) => { fn.mockImplementation(() => { throw err; }); return spy; },
      stub: () => { fn.mockImplementation(() => undefined); return spy; },
      resolveTo: (val: any) => { fn.mockResolvedValue(val); return spy; },
      rejectWith: (err: any) => { fn.mockRejectedValue(err); return spy; },
    };
    spy.calls = {
      count: () => fn.mock.calls.length,
      mostRecent: () => toCallData(fn, fn.mock.calls.length - 1),
      argsFor: (i: number) => fn.mock.calls[i],
      allArgs: () => fn.mock.calls,
      all: () => fn.mock.calls.map((_args, i) => toCallData(fn, i)),
      any: () => fn.mock.calls.length > 0,
      reset: () => { fn.mockClear(); },
      first: () => toCallData(fn, 0),
    };
    return spy;
  };
  (globalThis as any).jasmine = {
    // Asymmetric matchers — delegate to jest's equivalents so they compose
    // with jest matchers (toHaveBeenCalledWith, toEqual, …).
    any: (ctor: any) => expect.any(ctor),
    anything: () => expect.anything(),
    objectContaining: (obj: any) => expect.objectContaining(obj),
    arrayContaining: (arr: any) => expect.arrayContaining(arr),
    stringContaining: (s: any) => expect.stringContaining(s),
    stringMatching: (s: any) => expect.stringMatching(s),
    createSpy: (...args: any[]) => {
      const name = args[0] ?? 'spy';
      const fn = jest.fn();
      fn.toString = () => `jasmine.createSpy(${name})`;
      return wrapSpy(fn);
    },
    createSpyObj: (...args: any[]) => {
      const name = args[0] ?? 'obj';
      const methods = Array.isArray(args[1]) ? args[1] : (typeof args[1] === 'object' && args[1] !== null ? Object.keys(args[1]) : []);
      const props = (typeof args[1] === 'object' && args[1] !== null && !Array.isArray(args[1])) ? args[1] : {};
      const obj: any = {};
      for (const m of methods) {
        const spy = jest.fn();
        obj[m] = wrapSpy(spy);
        if (props[m] !== undefined) {
          obj[m].and.returnValue(props[m]);
        }
      }
      return obj;
    },
    // Deliberately throwing rather than no-op: a silent stub would let specs
    // pass while time never advances — worse than a loud failure.
    clock: () => ({
      install: () => { throw new Error('jasmine.clock is not supported — use jest.useFakeTimers() / jest.advanceTimersByTime()'); },
      uninstall: () => {},
      tick: (ms: number) => { throw new Error('jasmine.clock is not supported — use jest.useFakeTimers() / jest.advanceTimersByTime()'); },
      mockDate: (date: Date) => { throw new Error('jasmine.clock is not supported — use jest.useFakeTimers() / jest.setSystemTime()'); },
    }),
  };
}
