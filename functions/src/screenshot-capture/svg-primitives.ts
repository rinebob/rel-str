/**
 * SVG primitives — deterministic element emitters for the screenshot
 * renderer. Every function returns an SVG fragment string; coordinates arrive
 * pre-mapped to pixels (the layout/scales own all data→pixel math). Output is
 * byte-stable for identical input: numbers are rounded to a fixed precision
 * and text is XML-escaped.
 */

/** Round to 2 decimals and normalize -0 — keeps output deterministic and compact. */
export function n2(v: number): string {
  const r = Math.round(v * 100) / 100;
  return (r === 0 ? 0 : r).toString();
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

export function rect(
  x: number, y: number, w: number, h: number,
  fill: string, opts: { opacity?: number } = {},
): string {
  const o = opts.opacity !== undefined ? ` fill-opacity="${n2(opts.opacity)}"` : '';
  return `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" fill="${fill}"${o}/>`;
}

interface StrokeOpts {
  width?: number;
  dashArray?: string;
  opacity?: number;
}

function strokeAttrs(opts: StrokeOpts): string {
  const w = opts.width !== undefined ? ` stroke-width="${n2(opts.width)}"` : '';
  const d = opts.dashArray ? ` stroke-dasharray="${opts.dashArray}"` : '';
  const o = opts.opacity !== undefined ? ` stroke-opacity="${n2(opts.opacity)}"` : '';
  return `${w}${d}${o}`;
}

export function vline(
  x: number, y0: number, y1: number,
  stroke: string, opts: StrokeOpts = {},
): string {
  return `<line x1="${n2(x)}" y1="${n2(y0)}" x2="${n2(x)}" y2="${n2(y1)}" stroke="${stroke}"${strokeAttrs(opts)}/>`;
}

export function hline(
  y: number, x0: number, x1: number,
  stroke: string, opts: StrokeOpts = {},
): string {
  return `<line x1="${n2(x0)}" y1="${n2(y)}" x2="${n2(x1)}" y2="${n2(y)}" stroke="${stroke}"${strokeAttrs(opts)}/>`;
}

/** Polyline path from pixel points. Empty input → empty string. */
export function polyline(
  points: readonly { px: number; py: number }[],
  stroke: string,
  opts: StrokeOpts = {},
): string {
  if (points.length === 0) return '';
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${n2(p.px)} ${n2(p.py)}`).join(' ');
  return `<path d="${path}" fill="none" stroke="${stroke}"${strokeAttrs(opts)}/>`;
}

/** Closed band between an upper and a lower polyline (RangeArea equivalent).
 *  Traces high forward then low reversed. Disjoint segments are not split —
 *  sparse data arrives pre-filtered from the assembler. */
export function rangeFill(
  upper: readonly { px: number; py: number }[],
  lower: readonly { px: number; py: number }[],
  fill: string, opacity: number,
): string {
  if (upper.length === 0 || lower.length === 0) return '';
  const fwd = upper.map((p, i) => `${i === 0 ? 'M' : 'L'}${n2(p.px)} ${n2(p.py)}`).join(' ');
  const back = [...lower].reverse().map((p) => `L${n2(p.px)} ${n2(p.py)}`).join(' ');
  return `<path d="${fwd} ${back} Z" fill="${fill}" fill-opacity="${n2(opacity)}" stroke="none"/>`;
}

export function circle(
  cx: number, cy: number, r: number, fill: string, opts: { opacity?: number } = {},
): string {
  const o = opts.opacity !== undefined ? ` fill-opacity="${n2(opts.opacity)}"` : '';
  return `<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(r)}" fill="${fill}"${o}/>`;
}

/** OHLC candle: wick line plus body rect. `up` selects the fill. Caller
 *  guarantees slot geometry (center x, body width). */
export function candle(
  cx: number, bodyW: number,
  yOpen: number, yClose: number, yHigh: number, yLow: number,
  color: string, opts: { opacity?: number } = {},
): string {
  const top = Math.min(yOpen, yClose);
  const bodyH = Math.max(1, Math.abs(yOpen - yClose)); // flat candles get a 1px body line
  const o = opts.opacity !== undefined ? ` fill-opacity="${n2(opts.opacity)}" stroke-opacity="${n2(opts.opacity)}"` : '';
  return (
    `<line x1="${n2(cx)}" y1="${n2(yHigh)}" x2="${n2(cx)}" y2="${n2(yLow)}" stroke="${color}" stroke-width="1"${o}/>` +
    `<rect x="${n2(cx - bodyW / 2)}" y="${n2(top)}" width="${n2(bodyW)}" height="${n2(bodyH)}" fill="${color}"${o}/>`
  );
}

export function text(
  x: number, y: number, content: string,
  opts: { size?: number; fill: string; anchor?: 'start' | 'middle' | 'end'; weight?: string },
): string {
  const size = opts.size ?? 10;
  const fill = opts.fill;
  const anchor = opts.anchor ? ` text-anchor="${opts.anchor}"` : '';
  const weight = opts.weight ? ` font-weight="${opts.weight}"` : '';
  return `<text x="${n2(x)}" y="${n2(y)}" font-family="Roboto, Arial, sans-serif" font-size="${n2(size)}" fill="${fill}"${anchor}${weight}>${escapeXml(content)}</text>`;
}

/** Clip-path definition for a pane rect — keeps overflow (range fills,
 *  out-of-range overlay points) inside the pane like Syncfusion's plot clip. */
export function clipPath(id: string, x: number, y: number, w: number, h: number): {
  def: string;
  ref: string;
} {
  return {
    def: `<clipPath id="${id}"><rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}"/></clipPath>`,
    ref: `clip-path="url(#${id})"`,
  };
}
