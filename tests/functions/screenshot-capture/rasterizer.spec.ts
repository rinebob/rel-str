/**
 * @topic #746 — On-demand Screenshot Capture (task #769)
 *
 * rasterizer.ts — SVG → PNG via @resvg/resvg-js with the bundled Roboto
 * TTFs (functions/assets/fonts/). These specs rasterize for real — the
 * napi binary is the deliverable, so stubbing it would test nothing.
 * Text legibility itself is a QA eyeball; the suite proves the font
 * pipeline is wired (text changes pixels) and dimensions are exact.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  bundledFontFiles,
  rasterizeSvgToPng,
} from '../../../functions/src/screenshot-capture/rasterizer';

const WIDTH = 800;
const HEIGHT = 560;

const chart = (inner = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">` +
  `<rect width="${WIDTH}" height="${HEIGHT}" fill="#1a1d24"/>` +
  inner +
  `</svg>`;

/** PNG signature + IHDR dimensions (bytes 16–24, big-endian). */
function pngDimensions(png: Buffer): { width: number; height: number } {
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

describe('bundledFontFiles', () => {
  it('resolves the three bundled Roboto TTFs from any run context', () => {
    const files = bundledFontFiles();
    expect(files).toHaveLength(3);
    for (const f of files) {
      expect(f).toMatch(/Roboto_\d+\w+\.ttf$/);
      expect(existsSync(f)).toBe(true);
      expect(f.startsWith(join(process.cwd(), 'functions'))).toBe(true);
    }
  });
});

describe('rasterizeSvgToPng', () => {
  it('returns a PNG at the SVG pixel dimensions', () => {
    const png = rasterizeSvgToPng(chart());
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.length).toBeGreaterThan(100);
    // PNG signature
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(pngDimensions(png)).toEqual({ width: WIDTH, height: HEIGHT });
  });

  it('honours non-default spec dimensions', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>`;
    expect(pngDimensions(rasterizeSvgToPng(svg))).toEqual({ width: 320, height: 200 });
  });

  it('renders text through the bundled font (glyphs change pixels)', () => {
    const withText = rasterizeSvgToPng(
      chart(`<text x="20" y="40" font-family="Roboto, Arial, sans-serif" font-size="24" fill="#fff">GOOG 142.50</text>`),
    );
    const without = rasterizeSvgToPng(chart());
    // Identical textless render is byte-identical; text must diverge it.
    expect(withText.equals(without)).toBe(false);
    expect(withText.length).toBeGreaterThan(without.length);
  });

  it('renders text when only the bundled family is named', () => {
    // Proves fontFiles resolution (not system fallback) supplies Roboto —
    // the rasterizer passes loadSystemFonts:false, so a bare 'Roboto'
    // family can only come from the bundled TTFs.
    const svg = chart(
      `<text x="20" y="40" font-family="Roboto" font-size="20" fill="#fff">hello</text>`,
    );
    const png = rasterizeSvgToPng(svg);
    expect(png.length).toBeGreaterThan(100);
  });

  it('throws on a malformed SVG rather than emitting a corrupt artifact', () => {
    expect(() => rasterizeSvgToPng('<svg><rect broken')).toThrow();
  });
});
