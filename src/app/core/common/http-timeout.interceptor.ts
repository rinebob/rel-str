import { HttpInterceptorFn } from '@angular/common/http';
import { timeout, throwError } from 'rxjs';

import { HTTP_TIMEOUT_TOKEN } from './http-timeout.token';

/**
 * Applies a per-request timeout when the {@link HTTP_TIMEOUT_TOKEN} context
 * value is set. Requests without the token are unaffected (no global timeout).
 * On timeout, emits an RxJS TimeoutError so callers can handle it gracefully.
 */
export const httpTimeoutInterceptor: HttpInterceptorFn = (req, next) => {
  const timeoutMs = req.context.get(HTTP_TIMEOUT_TOKEN);
  if (timeoutMs === null) {
    return next(req);
  }
  return next(req).pipe(timeout(timeoutMs));
};
