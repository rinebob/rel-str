/**
 * SVG renderer — render model → deterministic SVG string.
 *
 * A dumb painter: the assembler owns data→model semantics (bar slicing,
 * date→index mapping, FE z-order rules via series order); this file only
 * maps model coordinates to pixels via `computeLayout` and emits elements.
 * Pane-level `windows` paint first (background annotation), series follow in
 * model order, reference lines last (FE stripLines use zIndex 'Over').
 *
 * Output guarantees (task #766 acceptance):
 *  - well-formed SVG (xmlns, viewBox, escaped text)
 *  - root carries data-plot-x / data-bar-width / data-bar-count for
 *    client-side bar-crop zoom (viewBox = plotX + i·barWidth window)
 *  - identical input → byte-identical output
 */

import type {
  CandleSeriesSpec,
  ChartRenderModel,
  ColumnSeriesSpec,
  LineSeriesSpec,
  RenderPaneWindowLayer,
  RenderSeries,
  ScatterSeriesSpec,
  RangeSeriesSpec,
} from './render-model';
import {
  EVENT_MARKER_COLOR,
  SCREENSHOT_DARK_PALETTE,
} from './chart-theme';
import { X_AXIS_HEIGHT, computeLayout } from './svg-layout';
import type { ChartLayout, PaneLayout } from './svg-layout';
import {
  candle,
  circle,
  clipPath,
  hline,
  polyline,
  rangeFill,
  rect,
  text,
  vline,
} from './svg-primitives';

const AXIS_LABEL_SIZE = 10;
const SMALL_LABEL_SIZE = 9;
const HEADER_TEXT_SIZE = 11;
const HEADER_TEXT_Y = 17;
const PLOT_HEADER_X = 8;

function renderCandle(s: CandleSeriesSpec, pl: PaneLayout, layout: ChartLayout): string {
  const up = s.upColor;
  const down = s.downColor;
  const bodyW = Math.max(1, layout.slotWidth * (s.widthFactor ?? 1));
  return s.data
    .filter((p) => [p.open, p.high, p.low, p.close].every(Number.isFinite))
    .map((p) => {
      const cx = layout.xCenter(p.x);
      return candle(
        cx, bodyW,
        pl.toY(p.open), pl.toY(p.close), pl.toY(p.high), pl.toY(p.low),
        p.close >= p.open ? up : down,
        { opacity: s.opacity },
      );
    })
    .join('');
}

function renderLine(s: LineSeriesSpec, pl: PaneLayout, layout: ChartLayout): string {
  // Split at non-finite points — FE emptyPointSettings 'Gap' breaks the
  // polyline rather than bridging interior holes.
  const segments: { px: number; py: number }[][] = [];
  let prevFinite = false;
  for (const p of s.data) {
    if (!Number.isFinite(p.y)) {
      prevFinite = false;
      continue;
    }
    const pt = { px: layout.xCenter(p.x), py: pl.toY(p.y) };
    if (prevFinite) {
      segments[segments.length - 1].push(pt);
    } else {
      segments.push([pt]);
    }
    prevFinite = true;
  }
  return segments
    .map((seg) => polyline(seg, s.color, {
      width: s.width ?? 2,
      dashArray: s.dashArray,
      opacity: s.opacity,
    }))
    .join('');
}

function renderScatter(s: ScatterSeriesSpec, pl: PaneLayout, layout: ChartLayout): string {
  return s.data
    .filter((p) => Number.isFinite(p.y))
    .map((p) =>
      circle(
        layout.xCenter(p.x),
        pl.toY(p.y),
        s.radius,
        p.color ?? s.color,
      ),
    )
    .join('');
}

function renderColumn(s: ColumnSeriesSpec, pl: PaneLayout, layout: ChartLayout): string {
  const w = Math.max(1, layout.slotWidth * (s.widthFactor ?? 1));
  const yBase = pl.toY(s.baseline ?? 0);
  return s.data
    .filter((p) => Number.isFinite(p.y))
    .map((p) => {
      const yTop = pl.toY(p.y);
      return rect(
        layout.xCenter(p.x) - w / 2,
        Math.min(yTop, yBase),
        w,
        Math.abs(yBase - yTop),
        p.color ?? s.color,
        { opacity: s.opacity },
      );
    })
    .join('');
}

function renderRange(s: RangeSeriesSpec, pl: PaneLayout, layout: ChartLayout): string {
  const finite = s.data.filter((p) => Number.isFinite(p.high) && Number.isFinite(p.low));
  const upper = finite.map((p) => ({ px: layout.xCenter(p.x), py: pl.toY(p.high) }));
  const lower = finite.map((p) => ({ px: layout.xCenter(p.x), py: pl.toY(p.low) }));
  return rangeFill(upper, lower, s.color, s.opacity);
}

function renderSeries(s: RenderSeries, pl: PaneLayout, layout: ChartLayout): string {
  switch (s.kind) {
    case 'candle': return renderCandle(s, pl, layout);
    case 'line': return renderLine(s, pl, layout);
    case 'scatter': return renderScatter(s, pl, layout);
    case 'column': return renderColumn(s, pl, layout);
    case 'range': return renderRange(s, pl, layout);
  }
}

/** Shaded zone windows — pane background, painted behind all series. */
function renderWindows(
  windows: RenderPaneWindowLayer[],
  pl: PaneLayout, layout: ChartLayout,
): string {
  return windows
    .flatMap((layer) => layer.data.map((w) => ({ w, layer })))
    .map(({ w, layer }) => {
      const x0 = layout.xCenter(w.x0) - layout.slotWidth / 2;
      const x1 = layout.xCenter(w.x1) + layout.slotWidth / 2;
      return rect(x0, pl.inner.y, x1 - x0, pl.inner.height, layer.color, {
        opacity: layer.opacity,
      });
    })
    .join('');
}

/** In-pane gridlines at tick positions. Color + layer follow FE: the
 *  log-scale price axis uses the brighter stripLine tone drawn OVER series
 *  (stripLines zIndex 'Over'); linear primary and lower axes use gridLine
 *  drawn beneath (majorGridLines). */
function renderPaneGridlines(pl: PaneLayout, layout: ChartLayout): string {
  const palette = SCREENSHOT_DARK_PALETTE;
  const gridColor = pl.pane.id === 'main' && layout.logScale
    ? palette.logTickLine
    : palette.gridLine;
  return pl.ticks
    .map((t) => hline(t.py, pl.inner.x, pl.inner.x + pl.inner.width, gridColor, { width: 0.5 }))
    .join('');
}

/** Whether this pane's gridlines paint over series (log stripLines) or
 *  beneath them (linear/lower majorGridLines). */
function gridlinesPaintOver(pl: PaneLayout, layout: ChartLayout): boolean {
  return pl.pane.id === 'main' && layout.logScale;
}

/** Right-gutter axis labels at tick positions. */
function renderPaneAxisLabels(pl: PaneLayout, layout: ChartLayout): string {
  const labelX = layout.plotRight + 4;
  return pl.ticks
    .map((t) => text(labelX, t.py + AXIS_LABEL_SIZE / 2 - 2, t.label, {
      size: AXIS_LABEL_SIZE,
      fill: SCREENSHOT_DARK_PALETTE.axisText,
    }))
    .join('');
}

function renderHeader(model: ChartRenderModel): string {
  const fields = [
    model.symbol,
    model.event,
    model.timestampIso,
    model.positionType,
    ...(model.refId ? [model.refId] : []),
    model.interval,
  ];
  return text(PLOT_HEADER_X, HEADER_TEXT_Y, fields.join(' · '), {
    size: HEADER_TEXT_SIZE,
    fill: SCREENSHOT_DARK_PALETTE.axisText,
    weight: 'bold',
  });
}

/** Vertical dashed marker + event label at the lifecycle-event bar. */
function renderEventMarker(model: ChartRenderModel, layout: ChartLayout): string {
  const idx = model.eventBarIndex ?? layout.barCount - 1;
  if (idx < 0 || idx >= layout.barCount) return '';
  const x = layout.xCenter(idx);
  const top = layout.panes[0]?.rect.y ?? layout.headerHeight;
  const last = layout.panes[layout.panes.length - 1];
  const bottom = last ? last.rect.y + last.rect.height : layout.height - X_AXIS_HEIGHT;
  // Marker sits on the last bar by default — label anchors left of the line
  // so it never clips against the axis gutter.
  const anchorLeft = idx >= layout.barCount - 3;
  return (
    vline(x, top, bottom, EVENT_MARKER_COLOR, { width: 1, dashArray: '4,3' }) +
    text(x + (anchorLeft ? -4 : 4), top + 10, model.event, {
      size: SMALL_LABEL_SIZE,
      fill: EVENT_MARKER_COLOR,
      anchor: anchorLeft ? 'end' : 'start',
    })
  );
}

/** Render the full chart. Same model in → same SVG out. */
export function renderChartSvg(model: ChartRenderModel): string {
  const layout = computeLayout(model);
  const palette = SCREENSHOT_DARK_PALETTE;

  const clips = layout.panes.map((pl) =>
    clipPath(pl.clipId, pl.inner.x, pl.inner.y, pl.inner.width, pl.inner.height),
  );
  const defs = clips.map((c) => c.def).join('');

  const paneParts: string[] = [];
  layout.panes.forEach((pl, i) => {
    // Gridlines under series except log-mode stripLines (FE zIndex 'Over').
    const gridlines = renderPaneGridlines(pl, layout);
    if (!gridlinesPaintOver(pl, layout)) paneParts.push(gridlines);
    const background = pl.pane.windows?.length ? renderWindows(pl.pane.windows, pl, layout) : '';
    const body = pl.pane.series.map((s) => renderSeries(s, pl, layout)).join('');
    const reflines = (pl.pane.referenceLines ?? []).map((ref) =>
      hline(pl.toY(ref.value), pl.inner.x, pl.inner.x + pl.inner.width,
        ref.color, { width: 1, dashArray: ref.dashArray }),
    );
    paneParts.push(`<g ${clips[i].ref}>${background}${body}${reflines.join('')}</g>`);
    if (gridlinesPaintOver(pl, layout)) paneParts.push(gridlines);
    paneParts.push(renderPaneAxisLabels(pl, layout));
    // Row divider at the pane's bottom edge; the top pane also gets its top
    // edge (header boundary) so every row shows a full border.
    if (i === 0) {
      paneParts.push(hline(pl.rect.y, layout.plotX, layout.plotRight, palette.paneDivider, { width: 1 }));
    }
    paneParts.push(hline(pl.rect.y + pl.rect.height, layout.plotX, layout.plotRight, palette.paneDivider, { width: 1 }));
  });

  // X labels — FE edgeLabelPlacement 'Shift': the rightmost label anchors to
  // the plot edge instead of overflowing into the axis gutter.
  const APPROX_CHAR_W = 4.8;
  const xLabels = layout.xTicks
    .map((t) => {
      const half = (t.label.length * APPROX_CHAR_W) / 2;
      const overflow = t.px + half > layout.plotRight;
      return text(overflow ? layout.plotRight - 2 : t.px, layout.height - 4, t.label, {
        size: SMALL_LABEL_SIZE,
        fill: palette.axisText,
        anchor: overflow ? 'end' : 'middle',
      });
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${model.width} ${model.height}" ` +
    `width="${model.width}" height="${model.height}" ` +
    // Crop metadata at full precision — the client multiplies bar-width by
    // bar index; 2dp rounding would drift the crop window on wide captures.
    `data-plot-x="${layout.plotX}" data-bar-width="${layout.slotWidth}" ` +
    `data-bar-count="${layout.barCount}">` +
    `<defs>${defs}</defs>` +
    rect(0, 0, model.width, model.height, palette.background) +
    renderHeader(model) +
    paneParts.join('') +
    renderEventMarker(model, layout) +
    xLabels +
    `</svg>`
  );
}
