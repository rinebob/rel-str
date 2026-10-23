# design-system-theme-plumbing-1207 — verify guide

Static relay for **#1207 — FE: data-theme bootstrap + ThemeService +
header toggle** (Topic #1024, Theme & Palette thread). No credentials,
no dev server, no sibling checkouts.

## Run

```bash
npx tsx scripts/verify/design-system-theme-plumbing-1207.ts
```

**Pass:** every check prints `OK`, footer `=== ALL 21 CHECKS PASSED ===`,
exit 0. **Fail:** `FAIL` lines name the broken invariant, exit 1.

## What it checks

### 1. index.html bootstrap (5 checks)

- `<head>` contains a synchronous inline script reading
  `localStorage['savant-theme']`, writing
  `document.documentElement.dataset.theme`, defaulting to `'dark'`,
  wrapped in try/catch (storage can throw in private mode), placed
  before `<app-root>` so it runs before the Angular bundle.

### 2. ThemeService authority (7 checks)

- `src/app/core/services/theme.service.ts` exists, root-provided,
  signal-backed `theme()`, writes `data-theme` on `documentElement`,
  persists `savant-theme`, exposes `set()`/`toggle()`, and does not
  probe `prefers-color-scheme` (checked on comment-stripped source).

### 3. Header toggle (2 checks)

- `header.component.ts` injects `ThemeService`; the template calls
  `theme.toggle()`.

### 4. Single-writer invariant (1 check)

- Recursive scan of `src/`: no file other than `index.html` (the
  sanctioned pre-paint bootstrap), `theme.service.ts`, and `*.spec.ts`
  writes `data-theme` on `documentElement`. The `/dev/ds` explorer's
  `[attr.data-theme]` host binding is preview-scoped and legal.

### 5. Spec surface (6 checks)

- `theme.service.spec.ts` exists and covers: default dark, stored
  light, corrupt fallback, toggle, set+persist (mirrors the task ACs).

## Setup / teardown

None. Safe to run repeatedly; read-only.
