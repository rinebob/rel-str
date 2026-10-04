// PROTOTYPE — throwaway variant C for the "Today" surface. Delete after decision.
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TodayMock, SURFACES } from './prototype-today.data';

interface FlowStep {
  name: string;
  headline: (d: TodayMock) => string;
  body: (d: TodayMock) => string[];
  route?: string;
}

const FLOW: FlowStep[] = [
  {
    name: 'Positions',
    headline: d => `${d.positions.needingAction} of ${d.positions.total} positions need action`,
    body: d => d.positions.intradayAlerts,
    route: SURFACES.portfolio.route,
  },
  {
    name: 'Signal funnel',
    headline: d => `${d.signalFunnel.raw} raw → ${d.signalFunnel.actionable} actionable`,
    body: d => [`watchlist ${d.signalFunnel.watchlist} → timeframe ${d.signalFunnel.timeframe} → direction ${d.signalFunnel.direction}`],
    route: SURFACES.signalReview.route,
  },
  {
    name: 'Decisions',
    headline: d => `${d.decisions.pending} pending — live ${d.decisions.live} · paper ${d.decisions.paper} · decline ${d.decisions.decline}`,
    body: () => ['Triage each candidate: live / paper / decline'],
    route: SURFACES.chartReview.route,
  },
  {
    name: 'Orders',
    headline: d => `${d.orders.queued} queued for placement`,
    body: d => [`submitted ${d.orders.submittedToday} · filled ${d.orders.fillsToday}`],
    route: SURFACES.signalOrder.route,
  },
  {
    name: 'Review',
    headline: d => `weekly — strategy analysis + results review due ${d.weekly.resultsReviewDue}`,
    body: () => ['What worked? What to change next week?'],
  },
];

@Component({
  selector: 'rs-proto-variant-guided-flow',
  imports: [RouterLink],
  template: `
    <div class="flow">
      <div class="stepper">
        @for (s of flow; track s.name; let i = $index) {
          <div class="step-dot" [class.done]="i < step()" [class.now]="i === step()" (click)="step.set(i)">
            <span class="n">{{ i + 1 }}</span>
            <span class="nm">{{ s.name }}</span>
          </div>
        }
      </div>
      <div class="stage">
        <h2>{{ current().name }}</h2>
        <p class="headline">{{ current().headline(data()) }}</p>
        @for (b of current().body(data()); track b) {
          <p class="body">{{ b }}</p>
        }
        <div class="actions">
          @if (current().route) {
            <a class="open" [routerLink]="current().route">Open surface →</a>
          }
          <button class="nav-btn" (click)="prev()" [disabled]="step() === 0">← Back</button>
          <button class="nav-btn primary" (click)="next()">{{ step() === flow.length - 1 ? 'Done' : 'Next' }} →</button>
        </div>
      </div>
      <p class="hint">Enforced sequence — the pathway is the product. Next/Skip moves you through the day.</p>
    </div>
  `,
  styles: [`
    .flow { padding: 24px; max-width: 720px; margin: 0 auto; }
    .stepper { display: flex; justify-content: space-between; margin-bottom: 32px; }
    .step-dot { display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; flex: 1; }
    .n { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #555; display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 13px; }
    .step-dot.done .n { background: #4caf50; border-color: #4caf50; color: #fff; }
    .step-dot.now .n { border-color: #64b5f6; color: #64b5f6; box-shadow: 0 0 0 4px #64b5f622; }
    .nm { font-size: 11px; color: #888; }
    .step-dot.now .nm { color: #64b5f6; }
    .stage { background: #1c1c1c; border: 1px solid #333; border-radius: 12px; padding: 28px; }
    .stage h2 { color: #eee; margin: 0 0 12px; }
    .headline { font-size: 20px; color: #ddd; margin: 0 0 12px; }
    .body { color: #999; margin: 4px 0; }
    .actions { display: flex; gap: 12px; margin-top: 24px; }
    .open { background: #1976d2; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; }
    .nav-btn { background: #333; color: #ddd; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; margin-left: auto; }
    .nav-btn.primary { background: #1976d2; color: #fff; margin-left: 0; }
    .nav-btn:disabled { opacity: .4; }
    .hint { margin-top: 20px; font-size: 12px; color: #777; text-align: center; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VariantGuidedFlowComponent {
  data = input.required<TodayMock>();
  flow = FLOW;
  step = signal(0);
  current = computed(() => FLOW[this.step()]);
  next() { this.step.update(s => Math.min(s + 1, FLOW.length - 1)); }
  prev() { this.step.update(s => Math.max(s - 1, 0)); }
}
