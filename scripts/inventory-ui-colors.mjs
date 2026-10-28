import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'vendor/savant-ds/styles'];
const sites = [];
const pattern = /#[\da-fA-F]{8}\b|#[\da-fA-F]{6}\b|#[\da-fA-F]{4}\b|#[\da-fA-F]{3}\b|(?:rgba?|hsla?|color-mix)\([^;{}\n]+|var\(--[\w-]+[^)]*\)|\b(?:transparent|currentColor)\b/g;

function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { scan(file); continue; }
    if (!/\.(scss|css|html|ts)$/.test(file) || /\.(spec|test)\.ts$/.test(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let blockComment = false;
    lines.forEach((source, index) => {
      const line = source.replace(/\/\*[\s\S]*?\*\//g, '');
      if (blockComment) { if (line.includes('*/')) blockComment = false; return; }
      if (/^\s*(\/\/|<!--)/.test(line)) return;
      if (line.includes('/*') && !line.includes('*/')) { blockComment = true; return; }
      for (const match of line.matchAll(pattern)) {
        const value = match[0];
        const token = value.startsWith('var(');
        const colorContext = /color|background|border|fill|stroke|shadow|palette|gradient|rgba|hsla|#[\da-f]/i.test(line);
        if (token && !colorContext && !/surface|primary|secondary|tertiary|error|success|warning|outline|accent|ds-up|ds-down/.test(value)) continue;
        sites.push({ file: file.replaceAll('\\', '/'), line: index + 1, value,
          kind: token ? 'token-reference' : value.startsWith('#') ? 'literal' : 'expression',
          area: /chart|indicator|series|heatmap/.test(file) ? 'chart-indicator-review' : /order|ticket|position|signal/.test(file) ? 'trading-semantic-review' : 'app-chrome-review',
          source: source.trim(),
        });
      }
    });
  }
}
roots.forEach(scan);
const output = {
  scope: roots,
  limitations: 'Static candidate inventory, not a CSS parser. Includes inactive code and may include non-color variable references. Excludes tests, assets, node_modules, runtime API colors and external library styles. Named CSS colors and dynamically assembled values require manual review. Area labels are path-based review hints, not semantic assignments.',
  supportGaps: ['Brand/action/focus/selection roles', 'Surface/text/border/elevation tiers', 'Up-long/down-short colors and container pairs', 'Independent success/error/warning/info roles', 'Chart series, indicators, heatmaps and overlays', 'Disabled/hover/active states and opacity treatments', 'Third-party Material/Syncfusion adapters'],
  summary: { sites: sites.length, files: new Set(sites.map(s => s.file)).size, literals: sites.filter(s => s.kind === 'literal').length },
  sites,
};
const target = 'docs/topics/1024-design-system/ui-color-sites.json';
fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
console.log(target, output.summary);
