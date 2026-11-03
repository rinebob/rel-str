**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** De-Materify  
**Thread Slug:** de-materify  
**Issue:** #1385  
**Thread Parent:** #1163  
**Topic Parent:** #1024  
**Task:** #1348  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-03  
**Last Updated:** 2026-11-03  

# UAT — #1348: dev/ds-elements live element zoo

## Scope

`/dev/ds-elements` — one live representative specimen of every UI element
archetype currently in use in the app (per `ui-element-sites.json`),
grouped by family, with usage counts, provenance, and NOW / DS TODAY /
TARGET panes. The page is the migration testbed for #1163 phases A–H.

## Prerequisites

- Dev server: `npm start` (or `npx ng serve` — port 4210)
- Signed-in session (route carries `authGuard`, same as `/dev/ds`)
- No external services or credentials needed — all specimens are static
  demos backed by local signals

## Scenarios

### S1 — Route + page loads
- Navigate to `http://localhost:4210/dev/ds-elements` (or Tools ▸ Dev ▸
  "DS Elements (Dev)" in the sidenav).
- Expected: header "DS Elements", meta line `49 specimens · 54
  archetypes · 3219 usages` (counts are snapshot-pinned; regenerating
  `ui-element-sites.json` will change them), accent picker, dark/light
  toggle.
- Result: PASS — user visual pass 2026-11-03 ("looks really good")

### S2 — Family sections
- Expected: exactly 10 `<section class="family">` groups — Buttons,
  Forms (Material), Styled natives, Overlays & popups, Data display,
  Icons, Layout & nav, CDK primitives, Syncfusion, Savant-DS widgets.
- Result: PASS — user visual pass 2026-11-03

### S3 — Card anatomy
- Every `article.card` shows: archetype name, `N×` count chip,
  REPLACE/ADOPT/NEW/KEEP/DECISION/DROP plan chip, three panes labeled
  NOW | DS TODAY | TARGET, and a `seen in:` footer with real app
  surfaces.
- Result: PASS — user visual pass 2026-11-03

### S4 — Material specimens are live, not sketches
- mat-select opens a real option panel on click; mat-checkbox toggles;
  mat-table renders 3 rows + sort/paginator; mat-menu opens on click;
  the snackbar button fires a real MatSnackBar; mat-expansion expands;
  mat-tab-group switches tabs; mat-datepicker input accepts a date.
- Result: PASS — user visual pass 2026-11-03

### S5 — Error-state form field is genuine
- The "mat-form-field parts" card shows a Required field already in
  error (red outline + "Required" mat-error) — driven by a real
  touched+invalid FormControl, not CSS classes.
- Result: PASS — user visual pass 2026-11-03

### S6 — DS TODAY / TARGET specimens styled by real mixins
- ds-btn fill/outline/ghost/danger variants visibly distinct;
  `.dse-*` specimens (field, check, radio, switch, select, combobox,
  dialog, menu, toast, table, accordion, tabs, card, spinner/progress)
  render styled chrome — no unstyled plain markup.
- Result: PASS — user visual pass 2026-11-03

### S7 — ARIA contracts visible in DevTools
- Inspect: `.dse-tabs` has role=tablist + role=tab + aria-selected +
  aria-controls; accordion heads aria-expanded + aria-controls with
  role=region bodies; combobox input role=combobox + aria-expanded +
  aria-activedescendant; menu role=menu/menuitem; dialog role=dialog +
  aria-modal + aria-labelledby; toast role=status; sortable th has
  tabindex=0 + aria-sort.
- Result: PASS — user visual pass 2026-11-03

### S8 — Theme toggle
- Click the dark/light control: `data-theme` on the host flips; ALL
  specimens (Material + ds-*) re-theme — light mode shows the restated
  light token layer, dark the shipped dark layer.
- Result: PASS — user visual pass 2026-11-03

### S9 — Accent picker
- Pick e.g. Mint: `--ds-accent` and the derived family
  (on-accent/container/glow/text) push onto the host; ds-* AND Material
  specimens re-accent live. 'current' restores the app accent.
  Caveat: overlay-rendered specimens (mat-menu/tooltip/snackbar/
  datepicker popups) render on `<body>` and follow the APP accent —
  inherent CDK limitation, not a bug.
- Result: PASS — user visual pass 2026-11-03

### S10 — Honest-mock markers
- mat-dialog and mat-sidenav cards carry a visible "DOM shape — not a
  live …" tag; cdk-overlay and syncfusion cards are self-describing
  notes/code blocks.
- Result: PASS — user visual pass 2026-11-03

### S11 — No unhandled specimen kinds
- No `.specimen-missing` element anywhere (a missing `@case` renders a
  loud red marker; spec asserts none exists).
- Result: PASS — user visual pass 2026-11-03

## Automated acceptance (command evidence)

| Check | Command | Result |
|---|---|---|
| Zoo spec (13 tests — JSON pin, coverage, panes, ARIA-free DOM) | `npx jest src/app/features/ds-elements --coverage=false` | PASS — 13/13 (2026-11-03) |
| Gallery spec (16 — ds-btn card + accent-text) | `npx jest src/app/features/ds-gallery --coverage=false` | PASS — 16/16 |
| Nav specs (route + submenu + sidenav) | `npx jest src/app/core/common/nav-sections.spec.ts src/app/core/comps/sidenav-menu --coverage=false` | PASS — 97/97 combined w/ above |
| Restate drift pins (incl. zoo §5b) | `npx tsx scripts/verify/design-system-palette-lock-1211.ts` | PASS — 22/22 |
| Token contract + vendor parity | `npx tsx scripts/verify/design-system-theme-tokens-1204.ts` | PASS — 53/53 |
| Canonical DS verify (~500 assertions) | `cd ../savant-ds && npm run verify` | PASS — "All checks passed." |
| Vendor byte-parity (both apps) | `diff -rq vendor/savant-ds/styles ../savant-ds/styles` | PASS — identical, both apps |
| Production build | `npx ng build` | PASS — bundle complete, no errors |

## Traceability

| AC | Scenarios |
|---|---|
| Route dev/ds-elements registered, dev-only | S1 (+nav spec) |
| One section per family (10) | S2 |
| Every archetype: live sample + count + source labels | S3, S4, S6, S9, S11 |
| Theme toggle respected, --ds-surface canvas | S8, S9 |
| NOW/DS TODAY/TARGET migration-testbed panes | S3, S6 |

## Regression / smoke

- `/dev/ds` gallery still renders its 10 widget cards incl. the new
  ds-btn card; accent previews still derive (now incl. accent-text).
  Result: PASS — user visual pass 2026-11-03.
- Dev submenu lists all 5 dev routes; no duplicate nav entries.
  Result: PASS — user visual pass 2026-11-03.

## Manual pass evidence

Visual/refinement pass executed by the user on 2026-11-03 against
`localhost:4210/dev/ds-elements` and `/dev/ds` — verdict "looks really
good", covering S1–S11 plus the gallery regression smoke. No visual
defects reported. The only known limitation (CDK overlay popups follow
the app accent, not the picked preview accent) was acknowledged as
by-design.
