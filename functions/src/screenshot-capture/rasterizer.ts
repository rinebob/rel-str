/**
 * rasterizer — SVG → PNG via @resvg/resvg-js prebuilt napi binary
 * (task #769). One narrow seam: `rasterizeSvgToPng`. The callable injects
 * it (paper-trading handler pattern) so contract tests stay free of the
 * native module; verify scripts exercise the real rasterization.
 *
 * Text renders through the bundled Roboto TTFs (functions/assets/fonts/)
 * — `loadSystemFonts: false` makes output host-independent: identical on
 * Cloud Functions (no system fonts to rely on) and dev machines.
 *
 * Kept as a runtime dependency, not bundled: esbuild externalizes
 * `@resvg/resvg-js` (native .node binaries can't bundle) and the deploy
 * install resolves the linux-x64-gnu binary from optionalDependencies.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const BUNDLED_FONT_FILES = [
  'Roboto_400Regular.ttf',
  'Roboto_500Medium.ttf',
  'Roboto_700Bold.ttf',
];

/**
 * Absolute paths to the bundled TTFs. Font dir lives at
 * `functions/assets/fonts/`; resolved from cwd because the module runs in
 * three layouts — jest (repo-root cwd), tsx verify scripts + the bundled
 * lib (functions cwd), and deployed GCF (package-root cwd). Deliberately
 * not `import.meta`-relative: the transform under jest is CJS.
 */
export function bundledFontFiles(): string[] {
  const candidates = [
    join(process.cwd(), 'assets/fonts'),
    join(process.cwd(), 'functions/assets/fonts'),
  ];
  const dir = candidates.find((d) =>
    BUNDLED_FONT_FILES.every((f) => existsSync(join(d, f))),
  );
  if (!dir) {
    throw new Error(`bundled Roboto fonts not found (searched: ${candidates.join(', ')})`);
  }
  return BUNDLED_FONT_FILES.map((f) => join(dir, f));
}

/**
 * Render `svg` to a PNG buffer at the SVG's own pixel dimensions (the
 * renderer already writes spec width/height into the root element).
 * Throws on malformed SVG — callers map to the callable error contract.
 */
export function rasterizeSvgToPng(svg: string, fontFiles = bundledFontFiles()): Buffer {
  return new Resvg(svg, {
    font: {
      fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: 'Roboto',
      sansSerifFamily: 'Roboto',
    },
    logLevel: 'off',
  }).render().asPng();
}
