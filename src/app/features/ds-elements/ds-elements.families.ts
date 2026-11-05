/**
 * /dev/ds-elements specimen catalog (extracted from the component — pure
 * data, no framework deps). SpecimenKind/PaneSpec/Specimen/FAMILIES.
 *
 * Counts are pinned against docs/topics/1024-design-system/
 * ui-element-sites.json by the component spec — regenerate the page data
 * when the JSON regens.
 */

export type SpecimenKind =
  | 'mat-button' | 'mat-stroked-button' | 'mat-flat-button'
  | 'mat-raised-button' | 'mat-icon-button' | 'mat-button-toggle'
  | 'native-button'
  | 'mat-form-field' | 'mat-form-field-parts' | 'mat-select' | 'mat-checkbox'
  | 'mat-radio' | 'mat-slide-toggle' | 'mat-datepicker' | 'mat-autocomplete'
  | 'native-input' | 'native-input-checkbox' | 'native-input-date'
  | 'native-input-radio' | 'native-input-file'
  | 'native-select' | 'native-textarea'
  | 'mat-dialog' | 'mat-tooltip' | 'mat-menu' | 'mat-snackbar'
  | 'mat-table' | 'mat-chip' | 'mat-spinner' | 'mat-icon'
  | 'mat-expansion' | 'mat-tab' | 'mat-sidenav' | 'mat-card'
  | 'mat-toolbar' | 'mat-list'
  | 'cdk-virtual-scroll' | 'cdk-overlay'
  | 'syncfusion'
  | 'ds-pill-toggle' | 'ds-pill-btn' | 'ds-badge' | 'ds-icon-btn'
  | 'ds-toolbar-row' | 'ds-nav-stepper' | 'ds-field-input'
  | 'ds-toggle-chip' | 'ds-dir-edge' | 'ds-dense-table' | 'ds-btn'
  | 'ds-field' | 'ds-check' | 'ds-radio' | 'ds-switch' | 'ds-select'
  | 'ds-combobox' | 'ds-date' | 'ds-dialog' | 'ds-menu' | 'ds-tooltip'
  | 'ds-toast' | 'ds-table' | 'ds-spinner' | 'ds-accordion' | 'ds-tabs'
  | 'ds-card'
  | 'rh-select-menu';

/**
 * What renders in one pane. `kind` renders a real specimen via the
 * shared switch; `note` renders plain text (KEEP / DECISION / "no ds
 * equivalent").
 */
export interface PaneSpec {
  kind?: SpecimenKind;
  label?: string;
  note?: string;
}

export interface Specimen {
  kind: SpecimenKind;
  name: string;
  /** Usages at snapshot time — summed over `archetypes` in the JSON. */
  count: number;
  /** ui-element-sites.json archetype names this card covers — the spec
   *  pins count = sum(archetype counts) and full-JSON coverage. */
  archetypes: string[];
  /** Disposition from the #1347 matrix — shown as the chip. */
  plan: 'REPLACE' | 'ADOPT' | 'NEW' | 'KEEP' | 'DECISION' | 'DROP';
  planNote: string;
  seenIn: string[];
  /** Middle pane — existing ds impl this maps to, if any. */
  ds?: PaneSpec;
  /** Right pane — planned target or alternate candidate. */
  target?: PaneSpec;
}

export interface Family { title: string; blurb: string; items: Specimen[] }

export const FAMILIES: readonly Family[] = [
  {
    title: 'Buttons',
    blurb: '650 usages — the worst inconsistency in the app. Six Material archetypes plus styled natives; no hierarchy. Phase A builds ds-btn variants.',
    items: [
      { kind: 'mat-button', name: 'mat-button', count: 59, archetypes: ['mat-button'],
        plan: 'REPLACE', planNote: 'ds-btn', seenIn: ['analysis', 'dashboard-v2 — 28 files'],
        target: { kind: 'ds-btn', label: 'ds-btn (ghost variant)' } },
      { kind: 'mat-stroked-button', name: 'mat-stroked-button', count: 122, archetypes: ['mat-stroked-button'],
        plan: 'REPLACE', planNote: 'ds-btn .outline', seenIn: ['order-ticket', 'option-chart', 'spread-builder-dialog — 43 files'],
        target: { kind: 'ds-btn', label: 'ds-btn .outline' } },
      { kind: 'mat-flat-button', name: 'mat-flat-button', count: 55, archetypes: ['mat-flat-button'],
        plan: 'REPLACE', planNote: 'ds-btn .fill', seenIn: ['dashboard', 'stock-list-selector — 33 files'],
        target: { kind: 'ds-btn', label: 'ds-btn .fill' } },
      { kind: 'mat-raised-button', name: 'mat-raised-button', count: 15, archetypes: ['mat-raised-button'],
        plan: 'REPLACE', planNote: 'ds-btn .fill (CTA)', seenIn: ['header — 10 files'],
        target: { kind: 'ds-btn', label: 'ds-btn .fill' } },
      { kind: 'mat-icon-button', name: 'mat-icon-button', count: 105, archetypes: ['mat-icon-button'],
        plan: 'ADOPT', planNote: 'ds.icon-btn exists', seenIn: ['signal-review-header', 'option-chart — 45 files'],
        ds: { kind: 'ds-icon-btn', label: 'ds.icon-btn' }, target: { kind: 'ds-icon-btn', label: 'adopt ds.icon-btn' } },
      { kind: 'mat-button-toggle', name: 'mat-button-toggle', count: 63, archetypes: ['mat-button-toggle'],
        plan: 'ADOPT', planNote: 'ds.pill-toggle exists', seenIn: ['dashboard-v3', 'option-group-generator', 'closed-grid — 16 files'],
        ds: { kind: 'ds-pill-toggle', label: 'ds.pill-toggle' }, target: { kind: 'ds-pill-toggle', label: 'adopt ds.pill-toggle' } },
      { kind: 'native-button', name: 'native <button> (no mat-)', count: 231, archetypes: ['native-button'],
        plan: 'REPLACE', planNote: 'ds-btn family', seenIn: ['swing-settings-dialog — 55 files of styled natives'],
        target: { kind: 'ds-btn', label: 'ds-btn family' } },
    ],
  },
  {
    title: 'Forms (Material)',
    blurb: '601 usages. mat-form-field+matInput is the dominant pattern; select has three coexisting implementations (decision D1).',
    items: [
      { kind: 'mat-form-field', name: 'mat-form-field + matInput', count: 210, archetypes: ['mat-form-field', 'matInput'],
        plan: 'REPLACE', planNote: 'ds-field', seenIn: ['spread-builder-dialog', 'strategy-builder-form', 'option-group-generator — 25+22 files'],
        ds: { kind: 'ds-field-input', label: 'ds.field-input (seed)' }, target: { kind: 'ds-field', label: 'ds-field' } },
      { kind: 'mat-form-field-parts', name: 'form-field parts (label/hint/error/suffix)', count: 163, archetypes: ['mat-form-field-parts'],
        plan: 'REPLACE', planNote: 'folds into ds-field chrome', seenIn: ['option-group-generator', 'strategy-builder-form', 'spread-builder-dialog — 33 files'],
        target: { kind: 'ds-field', label: 'ds-field (label+hint contract)' } },
      { kind: 'mat-select', name: 'mat-select + mat-option', count: 116, archetypes: ['mat-select', 'mat-option'],
        plan: 'DECISION', planNote: 'D1: candidates →', seenIn: ['spread-builder-dialog', 'options-replay-new-run-dialog — 19+20 files'],
        ds: { kind: 'native-select', label: 'candidate: native <select>' }, target: { kind: 'ds-select', label: 'candidate: ds-select (styled native); rh-select-menu below' } },
      { kind: 'mat-checkbox', name: 'mat-checkbox', count: 21, archetypes: ['mat-checkbox'],
        plan: 'NEW', planNote: 'ds-check (styled native)', seenIn: ['option-chart — 13 files'],
        target: { kind: 'ds-check', label: 'ds-check' } },
      { kind: 'mat-radio', name: 'mat-radio', count: 6, archetypes: ['mat-radio'],
        plan: 'NEW', planNote: 'ds-radio', seenIn: ['allocation-assign-dialog — 2 files'],
        target: { kind: 'ds-radio', label: 'ds-radio' } },
      { kind: 'mat-slide-toggle', name: 'mat-slide-toggle', count: 14, archetypes: ['mat-slide-toggle'],
        plan: 'NEW', planNote: 'ds-switch', seenIn: ['option-chart — 8 files'],
        target: { kind: 'ds-switch', label: 'ds-switch' } },
      { kind: 'mat-datepicker', name: 'mat-datepicker', count: 59, archetypes: ['mat-datepicker'],
        plan: 'DECISION', planNote: 'ds-date (styled native input)', seenIn: ['option-group-generator', 'spread-builder-dialog', 'analysis-run-config — 10 files'],
        target: { kind: 'ds-date', label: 'candidate: ds-date' } },
      { kind: 'mat-autocomplete', name: 'mat-autocomplete', count: 12, archetypes: ['mat-autocomplete'],
        plan: 'NEW', planNote: 'ds-combobox', seenIn: ['stock-list-form — 4 files'],
        target: { kind: 'ds-combobox', label: 'ds-combobox' } },
    ],
  },
  {
    title: 'Styled natives',
    blurb: '158 usages — page-rolled form controls with no mat-* directive. (native <button> is grouped under Buttons.) Phase C folds these into ds-field/ds-select chrome.',
    items: [
      { kind: 'native-input', name: 'native <input> (text/number)', count: 88, archetypes: ['native-input-other'],
        plan: 'REPLACE', planNote: 'ds-field', seenIn: ['option-chain-pct-change', 'option-chain — 27 files'],
        ds: { kind: 'ds-field-input', label: 'ds.field-input' }, target: { kind: 'ds-field', label: 'ds-field' } },
      { kind: 'native-input-checkbox', name: 'native input[type=checkbox]', count: 23, archetypes: ['native-input-checkbox'],
        plan: 'REPLACE', planNote: 'ds-check', seenIn: ['flex-chart-sandbox', 'dev-screenshot — 8 files'],
        target: { kind: 'ds-check', label: 'ds-check' } },
      { kind: 'native-input-date', name: 'native input[type=date]', count: 8, archetypes: ['native-input-date'],
        plan: 'REPLACE', planNote: 'ds-date', seenIn: ['analysis-table', 'target-type-selector', 'swing-table — 5 files'],
        target: { kind: 'ds-date', label: 'ds-date' } },
      { kind: 'native-input-radio', name: 'native input[type=radio]', count: 5, archetypes: ['native-input-radio'],
        plan: 'REPLACE', planNote: 'ds-radio', seenIn: ['rs-chart-view — 2 files'],
        target: { kind: 'ds-radio', label: 'ds-radio' } },
      { kind: 'native-input-file', name: 'native input[type=file]', count: 3, archetypes: ['native-input-file'],
        plan: 'DECISION', planNote: 'n=3 — likely leave native', seenIn: ['new-trade — 1 file'],
        target: { note: 'leave native — single call site, no chrome needed' } },
      { kind: 'native-select', name: 'native <select>', count: 24, archetypes: ['native-select'],
        plan: 'DECISION', planNote: 'same D1 call', seenIn: ['frame-swing-dialog', 'option-order-ticket — 13 files'],
        ds: { kind: 'mat-select', label: 'candidate: mat-select' }, target: { kind: 'ds-select', label: 'candidate: ds-select' } },
      { kind: 'native-textarea', name: 'native <textarea>', count: 7, archetypes: ['native-textarea'],
        plan: 'REPLACE', planNote: 'ds-field (textarea)', seenIn: ['analysis-run-config — 6 files'],
        target: { kind: 'ds-field', label: 'ds-field (textarea)' } },
    ],
  },
  {
    title: 'Overlays & popups',
    blurb: '455 usages. Dialog is the big one — 71 files. The ds-dialog shell sets the pattern for every modal.',
    items: [
      { kind: 'mat-dialog', name: 'MatDialog / mat-dialog-*', count: 222, archetypes: ['MatDialog'],
        plan: 'REPLACE', planNote: 'ds-dialog shell', seenIn: ['indicator-config-dialog', 'allocation dialogs — 71 files'],
        target: { kind: 'ds-dialog', label: 'ds-dialog' } },
      { kind: 'mat-tooltip', name: 'matTooltip', count: 142, archetypes: ['matTooltip'],
        plan: 'DECISION', planNote: 'ds-tooltip vs title= attr', seenIn: ['signal-review-header', 'option-chart', 'chart-view-toolbar — 46 files'],
        target: { kind: 'ds-tooltip', label: 'candidate: ds-tooltip' } },
      { kind: 'mat-menu', name: 'mat-menu', count: 43, archetypes: ['mat-menu'],
        plan: 'NEW', planNote: 'ds-menu', seenIn: ['option-chart', 'analysis-table — 11 files'],
        target: { kind: 'ds-menu', label: 'ds-menu' } },
      { kind: 'mat-snackbar', name: 'MatSnackBar', count: 48, archetypes: ['MatSnackBar'],
        plan: 'NEW', planNote: 'ds-toast', seenIn: ['order-ticket.store', 'portfolio-dashboard — 23 files'],
        target: { kind: 'ds-toast', label: 'ds-toast' } },
    ],
  },
  {
    title: 'Data display',
    blurb: '267 usages but concentrated — mat-table lives in only 7 files. High blast radius per file.',
    items: [
      { kind: 'mat-table', name: 'mat-table + matSort + paginator', count: 176, archetypes: ['mat-table', 'matSort', 'mat-paginator'],
        plan: 'REPLACE', planNote: 'ds-table (dense-table precedent)', seenIn: ['spread-builder-dialog', 'trade-journal-table', 'closed-grid — 7+4+2 files'],
        ds: { kind: 'ds-dense-table', label: 'ds.dense-table (partial)' }, target: { kind: 'ds-table', label: 'ds-table + sortable + pager' } },
      { kind: 'mat-chip', name: 'mat-chip', count: 33, archetypes: ['mat-chip'],
        plan: 'ADOPT', planNote: 'ds.badge / pill family', seenIn: ['open-grid', 'option-chart — 6 files'],
        ds: { kind: 'ds-badge', label: 'ds.badge' }, target: { kind: 'ds-badge', label: 'adopt ds.badge / pill' } },
      { kind: 'mat-spinner', name: 'mat-spinner / progress-bar', count: 58, archetypes: ['mat-spinner/progress'],
        plan: 'NEW', planNote: 'ds-spinner + ds-progress', seenIn: ['option-chart — 42 files'],
        target: { kind: 'ds-spinner', label: 'ds-spinner + ds-progress' } },
    ],
  },
  {
    title: 'Icons',
    blurb: '495 usages — every surface. D2 separates the Material Icons FONT (keep) from the <span class="dse-icon"> element + MatIconModule (goes with Material).',
    items: [
      { kind: 'mat-icon', name: 'mat-icon element + MatIconModule', count: 495, archetypes: ['mat-icon'],
        plan: 'DECISION', planNote: 'D2: keep font — replace element/module', seenIn: ['order-ticket — 138 files, everywhere'],
        target: { note: 'D2 — keep glyph font (deliberate exception); <span class="dse-icon"> element retires with Material' } },
    ],
  },
  {
    title: 'Layout & nav',
    blurb: '135 usages. Card is already scoped as #1162; sidenav is the app shell — replaced last, if ever.',
    items: [
      { kind: 'mat-expansion', name: 'mat-expansion-panel / accordion', count: 34, archetypes: ['mat-expansion-panel'],
        plan: 'NEW', planNote: 'ds-accordion', seenIn: ['option-chain-pct-change', 'open-grid — 9 files'],
        target: { kind: 'ds-accordion', label: 'ds-accordion' } },
      { kind: 'mat-tab', name: 'mat-tab-group', count: 31, archetypes: ['mat-tab'],
        plan: 'NEW', planNote: 'ds-tabs', seenIn: ['portfolio-dashboard', 'gallery-ticket-dialog — 7 files'],
        target: { kind: 'ds-tabs', label: 'ds-tabs' } },
      { kind: 'mat-card', name: 'mat-card', count: 22, archetypes: ['mat-card'],
        plan: 'REPLACE', planNote: 'shared card (#1162)', seenIn: ['analysis — 7 files'],
        target: { kind: 'ds-card', label: 'ds-card — #1162' } },
      { kind: 'mat-sidenav', name: 'mat-sidenav / drawer (app shell)', count: 31, archetypes: ['mat-sidenav/drawer'],
        plan: 'KEEP', planNote: 'structural — revisit last', seenIn: ['core shell', 'option-chart — 11 files'],
        target: { note: 'KEEP — app shell; every page lives inside it' } },
      { kind: 'mat-toolbar', name: 'mat-toolbar', count: 8, archetypes: ['mat-toolbar'],
        plan: 'ADOPT', planNote: 'ds.toolbar-row', seenIn: ['trade-journal.view — 3 files'],
        ds: { kind: 'ds-toolbar-row', label: 'ds.toolbar-row' }, target: { kind: 'ds-toolbar-row', label: 'adopt ds.toolbar-row' } },
      { kind: 'mat-list', name: 'mat-list / nav-list', count: 9, archetypes: ['mat-list/nav-list'],
        plan: 'DROP', planNote: 'no widget — plain markup', seenIn: ['signal-list — 3 files'],
        target: { note: 'DROP — plain markup needs no ds element' } },
    ],
  },
  {
    title: 'CDK primitives',
    blurb: '28 usages — behavioral primitives, no visual surface. De-materify keeps them; future ds overlays build on CDK.',
    items: [
      { kind: 'cdk-virtual-scroll', name: 'cdk-virtual-scroll', count: 15, archetypes: ['cdk-virtual-scroll'],
        plan: 'KEEP', planNote: 'perf primitive — not visual', seenIn: ['heatmap-v3 — 5 files'],
        target: { note: 'KEEP — perf primitive, no visual surface' } },
      { kind: 'cdk-overlay', name: 'cdk-overlay / portal', count: 13, archetypes: ['cdk-overlay/portal'],
        plan: 'KEEP', planNote: 'ds-menu/tooltip will sit on CDK', seenIn: ['chain-grid', 'pct-change-grid'],
        target: { note: 'KEEP — future ds overlays build on it' } },
    ],
  },
  {
    title: 'Syncfusion',
    blurb: '61 usages — the chart domain. De-materify does not touch chart internals; tokens reach charts via fill/stroke inputs.',
    items: [
      { kind: 'syncfusion', name: 'syncfusion ejs-*/e-*', count: 61, archetypes: ['syncfusion-ejs', 'syncfusion-e-tags'],
        plan: 'KEEP', planNote: 'chart lib — literals tagged exceptions', seenIn: ['stats-panel', 'heatmap-chart', 'rs-chart', 'backtest charts'],
        target: { note: 'KEEP — chart domain; tokens reach it via fill/stroke inputs' } },
    ],
  },
  {
    title: 'Savant-DS widgets (adopted baseline)',
    blurb: 'What good looks like — the existing vocabulary from #1101 plus #1348\u2019s new element library. These are the targets everything above migrates toward.',
    items: [
      { kind: 'ds-btn', name: 'ds-btn', count: 0, archetypes: [],
        plan: 'NEW', planNote: 'phase A target — no consumers yet', seenIn: ['new — #1348'],
        ds: { note: 'new element' }, target: { note: 'becomes the button family' } },
      { kind: 'ds-pill-toggle', name: 'ds.pill-toggle', count: 122, archetypes: ['ds-pill-toggle'],
        plan: 'ADOPT', planNote: 'existing', seenIn: ['option-chain', 'chart-view-toolbar — 23 files'],
        ds: { note: 'this IS the ds impl' }, target: { note: 'adopted — grows as phases migrate' } },
      { kind: 'ds-pill-btn', name: 'ds.pill-btn', count: 42, archetypes: ['ds-pill-btn'],
        plan: 'ADOPT', planNote: 'existing', seenIn: ['signal-history', 'signal-review-header — 15 files'],
        ds: { note: 'this IS the ds impl' }, target: { note: 'adopted baseline' } },
      { kind: 'ds-badge', name: 'ds.badge', count: 88, archetypes: ['ds-badge'],
        plan: 'ADOPT', planNote: 'existing', seenIn: ['signal-table', 'review-header — 41 files'],
        ds: { note: 'this IS the ds impl' }, target: { note: 'adopted baseline' } },
      { kind: 'ds-icon-btn', name: 'ds.icon-btn', count: 44, archetypes: ['ds-icon-btn'],
        plan: 'ADOPT', planNote: 'existing', seenIn: ['chart-toolbar', 'group-panel — 15 files'],
        ds: { note: 'this IS the ds impl' }, target: { note: 'adopted baseline' } },
      { kind: 'ds-toolbar-row', name: 'ds.toolbar-row', count: 9, archetypes: ['ds-toolbar-row'],
        plan: 'ADOPT', planNote: 'existing', seenIn: ['chart-toolbar', 'signal-review-header — 6 files'],
        ds: { note: 'this IS the ds impl' }, target: { note: 'adopted baseline' } },
      { kind: 'ds-nav-stepper', name: 'ds.nav-stepper', count: 6, archetypes: ['ds-nav-stepper'],
        plan: 'ADOPT', planNote: 'existing', seenIn: ['chart-toolbar — 6 files'],
        ds: { note: 'this IS the ds impl' }, target: { note: 'adopted baseline' } },
      { kind: 'ds-field-input', name: 'ds.field-input', count: 9, archetypes: ['ds-field-input'],
        plan: 'ADOPT', planNote: 'exists — seed for ds-field', seenIn: ['ds-gallery — canonical demo (no app usage yet)'],
        ds: { note: 'this IS the ds impl' }, target: { kind: 'ds-field', label: 'grows into ds-field (forms phase)' } },
      { kind: 'ds-toggle-chip', name: 'ds.toggle-chip', count: 4, archetypes: ['ds-toggle-chip'],
        plan: 'ADOPT', planNote: 'existing', seenIn: ['scanner-compare-panel — 4 files'],
        ds: { note: 'this IS the ds impl' }, target: { note: 'adopted baseline' } },
      { kind: 'ds-dir-edge', name: 'ds.dir-edge', count: 13, archetypes: ['ds-dir-edge'],
        plan: 'ADOPT', planNote: 'existing', seenIn: ['signal-table rows — 8 files'],
        ds: { note: 'this IS the ds impl' }, target: { note: 'adopted baseline' } },
      { kind: 'rh-select-menu', name: 'rh-select-menu (app component)', count: 32, archetypes: ['rh-select-menu'],
        plan: 'DECISION', planNote: 'D1 candidate — in-house select precedent', seenIn: ['observation-tool-form — 14 files'],
        ds: { note: 'app-level component' }, target: { note: 'D1 — candidate basis for ds-select' } },
    ],
  },
];
