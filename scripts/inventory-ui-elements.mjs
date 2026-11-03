// Element/component inventory — the component-level analog of
// inventory-ui-colors.mjs. Enumerates Material, Syncfusion, DS-widget
// and styled-native element usages across src/app to drive the #1163
// de-materify disposition matrix. Re-runnable; emits JSON artifact.
import fs from 'node:fs';
import path from 'node:path';

const roots = ['src/app'];
const outputPath = 'docs/topics/1024-design-system/ui-element-sites.json';

// name: [category, regex] — counted per occurrence on comment-stripped
// text; matches immediately preceded by '/' are close-tags and dropped.
// Category names follow the inventory doc's § families.
const archetypes = {
  // ── Material: buttons & toggles ──────────────────────────────
  'mat-button':            ['buttons', /mat-button(?!-)/g],
  'mat-raised-button':     ['buttons', /mat-raised-button\b/g],
  'mat-stroked-button':    ['buttons', /mat-stroked-button\b/g],
  'mat-flat-button':       ['buttons', /mat-flat-button\b/g],
  'mat-icon-button':       ['buttons', /mat-icon-button\b/g],
  'mat-fab':               ['buttons', /mat-fab\b/g],
  'mat-mini-fab':          ['buttons', /mat-mini-fab\b/g],
  'mat-button-toggle':     ['buttons', /mat-button-toggle/g],
  // ── Material: forms ──────────────────────────────────────────
  'mat-form-field':        ['forms', /<mat-form-field/g],
  'mat-form-field-parts':  ['forms', /<mat-(label|hint|error)\b|mat(Label|Hint|Error|Prefix|Suffix)\b|mat-(prefix|suffix|hint|error)\b/g],
  'matInput':              ['forms', /\bmatInput\b/g],
  'mat-select':            ['forms', /mat-select\b|matSelectTrigger/g],
  'mat-option':            ['forms', /mat-option\b|mat-optgroup/g],
  'mat-checkbox':          ['forms', /mat-checkbox/g],
  'mat-radio':             ['forms', /mat-radio-(button|group)/g],
  'mat-slide-toggle':      ['forms', /mat-slide-toggle/g],
  'mat-slider':            ['forms', /mat-slider\b/g],
  'mat-datepicker':        ['forms', /mat-datepicker|matDatepicker/g],
  'mat-autocomplete':      ['forms', /mat-autocomplete|matAutocomplete/g],
  // ── Material: overlays & popups ─────────────────────────────
  'MatDialog':             ['overlays', /\bMatDialog\b|mat-dialog-|matDialogClose|MatDialogRef|MAT_DIALOG_DATA/g],
  'mat-menu':              ['overlays', /matMenuTriggerFor|mat-menu\b/g],
  'matTooltip':            ['overlays', /matTooltip|mat-tooltip/g],
  'MatSnackBar':           ['overlays', /\bMatSnackBar\b|mat-snack-bar/g],
  'MatBottomSheet':        ['overlays', /\bMatBottomSheet\b/g],
  // ── Material: layout & nav ──────────────────────────────────
  'mat-sidenav/drawer':    ['layout', /mat-(sidenav|drawer)|MatSidenav\b/g],
  'mat-toolbar':           ['layout', /mat-toolbar/g],
  'mat-tab':               ['layout', /mat-tab\b/g],
  'mat-expansion-panel':   ['layout', /mat-(accordion|expansion-panel)/g],
  'mat-card':              ['layout', /mat-card\b/g],
  'mat-list/nav-list':     ['layout', /mat-(nav-list|list\b)|<mat-list/g],
  'mat-divider':           ['layout', /mat-divider/g],
  'mat-stepper':           ['layout', /matStepper|mat-stepper|mat-step\b/g],
  'mat-grid-list':         ['layout', /mat-grid-list/g],
  // ── Material: data display & feedback ────────────────────────
  'mat-table':             ['data', /mat-table|matCellDef|matHeaderCellDef|matColumnDef|matRowDef|matHeaderRowDef|matFooterRowDef|matFooterCellDef|<table mat-/g],
  'mat-paginator':         ['data', /mat-paginator|MatPaginator\b/g],
  'matSort':               ['data', /\bmatSort|mat-sort-|MatSort\b/g],
  'mat-chip':              ['data', /mat-chip|matChip/g],
  'matBadge':              ['data', /\bmatBadge|mat-badge/g],
  'mat-icon':              ['icons', /mat-icon(?!-)/g],
  'mat-spinner/progress':  ['feedback', /mat-(spinner|progress)/g],
  'mat-tree':              ['data', /mat-tree\b|matTree/g],
  // ── CDK primitives ──────────────────────────────────────────
  'cdk-overlay/portal':    ['cdk', /cdkConnectedOverlay|cdkOverlayOrigin|cdkPortal|\bPortal\b/g],
  'cdk-drag-drop':         ['cdk', /cdkDropList|cdkDrag\b|cdkDragHandle|cdkDropListGroup/g],
  'cdk-virtual-scroll':    ['cdk', /cdk-virtual-scroll|cdkVirtualFor/g],
  'cdk-text-field/other':  ['cdk', /cdkTextareaAutosize|cdkTrapFocus|cdkMonitorFocus/g],
  // ── Syncfusion ──────────────────────────────────────────────
  'syncfusion-ejs':        ['syncfusion', /<ejs-/g],
  'syncfusion-e-tags':     ['syncfusion', /<e-(series|axes|axis|tooltip|legend|annotations|rangenavigator|crosshair)/g],
  // ── DS widgets (savant-ds adoptees) ─────────────────────────
  'ds-pill-toggle':        ['ds-widget', /class="[^"]*\bpill\b(?!-btn)|\.pill\b(?!-btn)\s*[{,&]/g],
  'ds-pill-btn':           ['ds-widget', /class="[^"]*\bpill-btn|\.pill-btn\b/g],
  'ds-icon-btn':           ['ds-widget', /class="[^"]*\bicon-btn|\.icon-btn\b/g],
  'ds-badge':              ['ds-widget', /class="[^"]*\bbadge\b|\.badge\b/g],
  'ds-toggle-chip':        ['ds-widget', /class="[^"]*\btoggle-chip|\.toggle-chip\b/g],
  'ds-field-input':        ['ds-widget', /class="[^"]*\bfield-input|\.field-input\b/g],
  'ds-dir-edge':           ['ds-widget', /class="[^"]*\bdir-edge|\.dir-edge\b/g],
  'ds-toolbar-row':        ['ds-widget', /class="[^"]*\btoolbar-row|\.toolbar-row\b/g],
  'ds-nav-stepper':        ['ds-widget', /class="[^"]*\bnav-stepper|\.nav-stepper\b|\.nav-btn\b/g],
  // ── Styled natives ──────────────────────────────────────────
  'native-button':         ['native', /<button(?![^>]*mat-)(?![^>]*class="[^"]*(?:pill|icon-btn|badge|toggle-chip|dir-edge|toolbar-row|nav-|field-input))/g],
  'native-select':         ['native', /<select\b/g],
  'native-textarea':       ['native', /<textarea\b/g],
  'native-input-checkbox': ['native', /<input(?![^>]*matInput)[^>]*type="checkbox"/g],
  'native-input-radio':    ['native', /<input(?![^>]*matInput)[^>]*type="radio"/g],
  'native-input-date':     ['native', /<input(?![^>]*matInput)[^>]*type="(date|datetime-local|month|week|time)"/g],
  'native-input-range':    ['native', /<input(?![^>]*matInput)[^>]*type="range"/g],
  'native-input-file':     ['native', /<input(?![^>]*matInput)[^>]*type="file"/g],
  'native-input-other':    ['native', /<input(?![^>]*matInput)(?![^>]*type="(checkbox|radio|date|datetime-local|month|week|time|range|file)")/g],
  // ── Custom DS-ish components ────────────────────────────────
  'rh-select-menu':        ['ds-component', /app-rh-select-menu|rh-select-menu|RhSelectMenu/g],
};

const sites = [];
const byArchetype = {};

function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { scan(file); continue; }
    if (!/\.(html|ts|scss|css)$/.test(file) || /\.(spec|test)\.ts$/.test(file)) continue;
    const rel = file.replaceAll('\\', '/');
    // Strip comments per line but keep line positions — `[^>]` lookaheads
    // must see the whole tag across line breaks, so match against the
    // cleaned full text and derive line numbers from match indices.
    const isHtml = /\.html$/.test(file);
    const open = isHtml ? '<!--' : '/*';
    const close = isHtml ? '-->' : '*/';
    const inline = isHtml ? /<!--[\s\S]*?-->/g : /\/\*[\s\S]*?\*\//g;
    const cleaned = [];
    let blockComment = false;
    for (const source of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = source.replace(inline, '').replace(/\s\/\/.*$/, '');
      if (blockComment) { if (line.includes(close)) blockComment = false; cleaned.push(''); continue; }
      if (/^\s*(\/\/|<!--)/.test(line)) { cleaned.push(''); continue; }
      if (line.includes(open) && !line.includes(close)) { blockComment = true; cleaned.push(''); continue; }
      cleaned.push(line);
    }
    const text = cleaned.join('\n');
    for (const [name, [category, re]] of Object.entries(archetypes)) {
      const matches = [...text.matchAll(re)].filter(m => text[m.index - 1] !== '/');
      if (!matches.length) continue;
      const count = matches.length;
      byArchetype[name] ??= { category, total: 0, files: {} };
      byArchetype[name].total += count;
      byArchetype[name].files[rel] = (byArchetype[name].files[rel] ?? 0) + count;
      for (const m of matches) {
        sites.push({ file: rel, line: text.slice(0, m.index).split('\n').length, archetype: name, count: 1 });
      }
    }
  }
}
roots.forEach(scan);

// Emit every declared archetype, zero-hit ones included, so the
// artifact itself documents scan coverage.
const allArchetypes = {};
for (const name of Object.keys(archetypes)) {
  const hit = byArchetype[name];
  allArchetypes[name] = hit
    ? { category: hit.category, total: hit.total,
        files: Object.fromEntries(
          Object.entries(hit.files).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }
    : { category: archetypes[name][0], total: 0, files: {} };
}

const output = {
  scope: roots,
  limitations: 'Static regex inventory — counts usages, not semantics. Attribute + selector + class-name matches on non-comment lines; close-tag occurrences are dropped; a line may contribute multiple usages. Excludes spec files, assets, node_modules. SCSS class selectors (.pill) may double-count template class= attrs. Buttons already carrying DS widget classes are excluded from native-button. mat-icon excludes mat-icon-button prefixes; ds-pill-toggle excludes pill-btn. TS-side class-name coverage is partial (e.g., MatDialog counted, MatSelectModule not). ds-component rows include the component\'s own files. Order-of-magnitude accuracy for prioritization, not bookkeeping.',
  summary: {
    filesWithUsages: new Set(sites.map(s => s.file)).size,
    usages: sites.reduce((n, s) => n + s.count, 0),
    archetypes: Object.keys(allArchetypes).filter(k => allArchetypes[k].total > 0).length,
    archetypesDeclared: Object.keys(allArchetypes).length,
  },
  archetypes: Object.fromEntries(
    Object.entries(allArchetypes).sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))),
  sites: sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.archetype.localeCompare(b.archetype)),
};
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(`${output.summary.usages} usages · ${output.summary.archetypes}/${output.summary.archetypesDeclared} archetypes · ${output.summary.filesWithUsages} files → ${outputPath}`);
