/**
 * /dev/screenshot — dev page for the captureChartSnapshot callable
 * (Topic #746, task #770).
 *
 * Spec form (symbol, event, intervals, optional size/visibleBars/refId
 * overrides) → callable → each returned artifact rendered inline (trusted
 * SVG — our own function produced it) alongside its storage paths. Typed
 * callable errors map to distinguishable messages.
 */
import {
  Component,
  ChangeDetectionStrategy,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { UiStateService } from '../../core/services/ui-state.service';
import { ScreenshotService } from './screenshot.service';
import { sliceSvgRight } from './svg-slice.util';
import {
  CAPTURE_AXIS_GUTTER_WIDTH,
  CAPTURE_PLOT_LEFT,
  CaptureChartResult,
  CaptureChartSpec,
  CaptureEvent,
  CaptureInterval,
  ChartInterval,
  PositionType,
} from '@screenshot-capture/contracts';

/** Callable error code → distinguishable operator-facing message. */
function describeError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const message = (err as Error)?.message ?? String(err);
  switch (code) {
    case 'functions/invalid-argument':
      return `Invalid spec (invalid-argument): ${message}`;
    case 'functions/failed-precondition':
      return `Capture precondition failed (failed-precondition) — usually not enough cached bars: ${message}`;
    case 'functions/unauthenticated':
      return `Unauthenticated — sign in required to capture: ${message}`;
    case 'functions/internal':
      return `Internal error — the callable failed: ${message}`;
    default:
      return `${code || 'unknown'}: ${message}`;
  }
}

@Component({
  selector: 'app-dev-screenshot',
  standalone: true,
  templateUrl: './dev-screenshot.component.html',
  styleUrl: './dev-screenshot.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevScreenshotComponent implements OnInit, OnDestroy {
  private readonly screenshots = inject(ScreenshotService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly ui = inject(UiStateService);

  readonly CaptureEvent = CaptureEvent;
  readonly ChartInterval = ChartInterval;
  readonly events = Object.values(CaptureEvent);

  // ── Form state ───────────────────────────────────────────────────────
  readonly symbol = signal('GOOG');
  readonly event = signal<CaptureEvent>(CaptureEvent.MANUAL);
  readonly intervalDaily = signal(true);
  readonly intervalWeekly = signal(true);
  readonly widthInput = signal('');
  readonly heightInput = signal('');
  readonly visibleBarsInput = signal('');
  readonly refIdInput = signal('');
  /** Primary capture writes SVG+PNG to GCS when checked (renderOnly:false).
   *  Playground variant/zoom re-renders always stay render-only. */
  readonly storeArtifacts = signal(true);

  // ── Result state ─────────────────────────────────────────────────────
  readonly submitting = signal(false);
  readonly result = signal<CaptureChartResult | null>(null);
  readonly error = signal<string | null>(null);

  // ── Playground (#771) ────────────────────────────────────────────────
  /** Card-size variants — the same captured SVG at native scale in
   *  different-width windows: same bar width and height, narrower cards
   *  show fewer bars off the right end (end of chart + y-axis kept). */
  readonly variants: readonly { key: string; label: string; widthPx?: number }[] = [
    { key: 'full', label: 'Full' },
    { key: 'lg', label: '480px', widthPx: 480 },
    { key: 'md', label: '320px', widthPx: 320 },
    { key: 'card', label: '~1.9in card', widthPx: 180 },
  ];
  /** Bars kept in a quick-zoom window. */
  readonly ZOOM_BARS = 15;
  /** Zoomed SVG per artifact key (interval) — a fresh render at
   *  visibleBars=ZOOM_BARS, so bars and y-axis rescale to the window. */
  readonly zoomSvgs = signal<Readonly<Record<string, string>>>({});
  readonly zoomPending = signal<ReadonlySet<string>>(new Set());
  private lastSpec: CaptureChartSpec | null = null;
  /** Monotonic capture id — in-flight variant/zoom responses from a
   *  superseded capture are dropped so stale SVGs can't surface under a
   *  newer result. */
  private captureSeq = 0;

  toggleZoom(interval: CaptureInterval): void {
    if (this.zoomSvgs()[interval]) {
      const next = { ...this.zoomSvgs() };
      delete next[interval];
      this.zoomSvgs.set(next);
      return;
    }
    if (this.zoomPending().has(interval) || !this.lastSpec) return;
    this.zoomPending.update((s) => new Set(s).add(interval));
    const seq = this.captureSeq;
    // Re-render the same spec narrowed to this interval at ZOOM_BARS —
    // a fresh render, never a storage write.
    this.screenshots
      .captureChartSnapshot$({ ...this.lastSpec, intervals: [interval], visibleBars: this.ZOOM_BARS, renderOnly: true })
      .subscribe({
        next: (res) => {
          if (seq !== this.captureSeq) return; // superseded capture — drop
          const svg = res.artifacts.find((a) => a.interval === interval)?.svg;
          if (svg) this.zoomSvgs.update((m) => ({ ...m, [interval]: svg }));
          this.zoomPending.update((s) => { const n = new Set(s); n.delete(interval); return n; });
        },
        error: (err: unknown) => {
          if (seq !== this.captureSeq) return;
          this.error.set(describeError(err));
          this.zoomPending.update((s) => { const n = new Set(s); n.delete(interval); return n; });
        },
      });
  }

  /** widthPx → interval → re-rendered svg (same height as the primary,
   *  visibleBars scaled to keep bar width). */
  readonly variantSvgs = signal<Readonly<Record<number, Record<string, string>>>>({});

  /** Per-variant callable renders — each variant is a fresh capture at
   *  widthPx × spec height with visibleBars chosen so slot width matches
   *  the full render (same bar width, fewer bars off the right end). */
  private loadVariants(spec: CaptureChartSpec, fullSvg: string, seq: number): void {
    const barWidth = Number(fullSvg.match(/data-bar-width="([\d.]+)"/)?.[1]);
    for (const v of this.variants) {
      if (v.widthPx === undefined) continue;
      const widthPx = v.widthPx;
      const plotW = widthPx - CAPTURE_PLOT_LEFT - CAPTURE_AXIS_GUTTER_WIDTH;
      const visibleBars =
        barWidth > 0 ? Math.max(3, Math.round(plotW / barWidth)) : undefined;
      const vSpec: CaptureChartSpec = {
        ...spec, width: widthPx,
        ...(visibleBars ? { visibleBars } : {}),
        renderOnly: true, // playground renders never write to GCS
      };
      this.screenshots.captureChartSnapshot$(vSpec).subscribe({
        next: (res) => {
          if (seq !== this.captureSeq) return; // superseded capture — drop
          const byInterval = Object.fromEntries(res.artifacts.map((a) => [a.interval, a.svg]));
          this.variantSvgs.update((m) => ({ ...m, [widthPx]: byInterval }));
        },
        error: (err: unknown) => {
          if (seq !== this.captureSeq) return;
          this.error.set(describeError(err));
        },
      });
    }
  }

  /** Sanitized svg for a variant — re-rendered variant when loaded
   *  (native-scale right slice as an instant placeholder until then);
   *  full variant and zoom show the base render untouched. */
  variantSvg(interval: string, svg: string, widthPx?: number): SafeHtml {
    const zoomed = this.zoomSvgs()[interval];
    if (widthPx === undefined) return this.trustedSvg(zoomed ?? svg);
    const base = zoomed ?? this.variantSvgs()[widthPx]?.[interval] ?? sliceSvgRight(svg, widthPx);
    return this.trustedSvg(zoomed ? sliceSvgRight(base, widthPx) : base);
  }

  ngOnInit(): void {
    this.ui.setFullscreen(true);
  }

  ngOnDestroy(): void {
    this.ui.setFullscreen(false);
  }

  onInput(sig: { set(v: string): void }, event: Event): void {
    sig.set((event.target as HTMLInputElement).value);
  }

  onSelect(sig: { set(v: CaptureEvent): void }, event: Event): void {
    sig.set((event.target as HTMLSelectElement).value as CaptureEvent);
  }

  onCheck(sig: { set(v: boolean): void }, event: Event): void {
    sig.set((event.target as HTMLInputElement).checked);
  }

  /**
   * The returned SVG is injected unsanitized — safe here ONLY because the
   * producer is our own Cloud Function, not user/remote content. Do not
   * copy this pattern for untrusted markup.
   */
  trustedSvg(svg: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  private buildSpec(): CaptureChartSpec | null {
    const symbol = this.symbol().trim().toUpperCase();
    if (!symbol) {
      this.error.set('Symbol is required.');
      return null;
    }
    const intervals: CaptureInterval[] = [
      ...(this.intervalDaily() ? [ChartInterval.DAILY as const] : []),
      ...(this.intervalWeekly() ? [ChartInterval.WEEKLY as const] : []),
    ];
    if (intervals.length === 0) {
      this.error.set('Select at least one interval.');
      return null;
    }
    const spec: CaptureChartSpec = {
      symbol,
      event: this.event(),
      positionType: PositionType.STOCK,
      intervals,
    };
    const width = parseInt(this.widthInput(), 10);
    const height = parseInt(this.heightInput(), 10);
    const refId = this.refIdInput().trim();
    const visibleBars = this.visibleBarsInput().trim();
    if (width > 0) spec.width = width;
    if (height > 0) spec.height = height;
    if (refId) spec.refId = refId;
    if (visibleBars === 'all') spec.visibleBars = 'all';
    else {
      const n = parseInt(visibleBars, 10);
      if (n > 0) spec.visibleBars = n;
    }
    spec.renderOnly = !this.storeArtifacts();
    return spec;
  }

  submit(event: Event): void {
    event.preventDefault();
    if (this.submitting()) return;
    const spec = this.buildSpec();
    if (!spec) return;
    this.submitting.set(true);
    this.error.set(null);
    this.result.set(null);
    this.lastSpec = spec;
    const seq = ++this.captureSeq;
    this.zoomSvgs.set({});
    this.zoomPending.set(new Set());
    this.variantSvgs.set({});
    this.screenshots.captureChartSnapshot$(spec).subscribe({
      next: (res) => {
        this.result.set(res);
        this.submitting.set(false);
        this.loadVariants(spec, res.svg, seq);
      },
      error: (err: unknown) => {
        this.error.set(describeError(err));
        this.submitting.set(false);
      },
    });
  }
}
