/**
 * Right-anchored 1:1 viewport slice for screenshot-capture SVGs
 * (Topic #746, task #771).
 *
 * Card variants don't rescale the chart — a narrower card shows the same
 * render at native scale with fewer bars: same bar width, same height, the
 * right end of the plot plus the y-axis. Done by rewriting the root viewBox
 * to a `width`-px window ending at the viewBox's right edge AND updating the
 * width/height attrs so the viewport aspect matches (otherwise the browser
 * letterboxes the crop and it reads as the wrong edge kept).
 */

const VIEWBOX_RE = /viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"/;
const SIZE_RE = /width="[\d.]+" height="[\d.]+"/;


/**
 * Returns `svg` showing only the rightmost `width` user-units of its
 * viewBox, rendered at native scale (width/height attrs = slice dims).
 * Returns the input unchanged when the svg is already ≤ `width` or the
 * root geometry is missing.
 */
export function sliceSvgRight(svg: string, width: number): string {
  const vb = svg.match(VIEWBOX_RE);
  if (!vb) return svg;
  const [, x0, y, w, h] = vb.map(Number);
  if (width <= 0 || w <= width) return svg;
  const cropX = x0 + w - width;
  let out = svg.replace(VIEWBOX_RE, `viewBox="${cropX} ${y} ${width} ${h}"`);
  out = SIZE_RE.test(out)
    ? out.replace(SIZE_RE, `width="${width}" height="${h}"`)
    : out.replace(/<svg/, `<svg width="${width}" height="${h}"`);
  return out;
}
