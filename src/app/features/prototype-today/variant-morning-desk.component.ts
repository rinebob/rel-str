// PROTOTYPE — throwaway variant A for the "Today" surface. Delete after decision.
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TodayMock, SURFACES } from './prototype-today.data';

interface DeskStep {
  title: string;
  status: 'done' | 'now' | 'later' | 'triggered' | 'weekly';
  detail: string;
  route?: string;
}

@Component({
  selector: 'rs-proto-variant-morning-desk',
  imports: [RouterLink],
  template: `
    <div class="desk">
      <nav class="rail">
        <div class="rail-title">Today</div>
        @for (s of steps(); track s.title) {
          <div class="step" [class.now]="s.status === 'now'">
            <span class="dot" [class.done]="s.status === 'done'" [class.now]="s.status === 'now'"></span>
            <div class="step-text">
              <div class="step-name">{{ s.title }}</div>
              <div class="step-detail">{{ s.detail }}</div>
            </div>
          </div>
        }
      </nav>
      <main class="pane">
        <h2>{{ active().title }}</h2>
        <p class="detail">{{ active().detail }}</p>
        <div class="facts">
          @if (active().title === 'Positions first') {
            <div class="fact"><b>{{ data().positions.needingAction }}</b> of {{ data().positions.total }} need action</div>
            @for (a of data().positions.intradayAlerts; track a) {
              <div class="alert">{{ a }}</div>
            }
          }
          @if (active().title === 'Signal funnel') {
            <div class="funnel">
              <div>{{ data().signalFunnel.raw }} raw</div>
              <div>→ {{ data().signalFunnel.watchlist }} watchlist</div>
              <div>→ {{ data().signalFunnel.timeframe }} timeframe</div>
              <div>→ {{ data().signalFunnel.direction }} direction</div>
              <div class="hot">→ {{ data().signalFunnel.actionable }} actionable</div>
            </div>
          }
          @if (active().title === 'Triggered work') {
            <div class="fact">{{ data().orders.queued }} candidates queued for order placement</div>
          }
          @if (active().title === 'Weekly') {
            <div class="fact">Strategy analysis due {{ data().weekly.strategyAnalysisDue }}</div>
            <div class="fact">Results review due {{ data().weekly.resultsReviewDue }}</div>
          }
        </div>
        @if (active().route) {
          <a class="open" [routerLink]="active().route">Open surface →</a>
        }
        <p class="hint">Rail order = run-sheet order. Each box is its own compartment — 150+ signals never on the desk at once.</p>
      </main>
    </div>
  `,
  styles: [`
    .desk { display: flex; gap: 24px; padding: 24px; }
    .rail { width: 260px; border-right: 1px solid #333; padding-right: 16px; }
    .rail-title { font-weight: 700; margin-bottom: 16px; color: #ccc; }
    .step { display: flex; gap: 10px; padding: 12px 8px; border-radius: 8px; }
    .step.now { background: #1e2a38; }
    .dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #666; margin-top: 4px; flex-shrink: 0; }
    .dot.done { background: #4caf50; border-color: #4caf50; }
    .dot.now { border-color: #64b5f6; box-shadow: 0 0 0 3px #64b5f633; }
    .step-name { font-weight: 600; color: #eee; }
    .step-detail { font-size: 12px; color: #999; margin-top: 2px; }
    .pane { flex: 1; max-width: 640px; }
    .pane h2 { color: #eee; margin: 0 0 8px; }
    .detail { color: #aaa; margin: 0 0 20px; }
    .facts { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
    .fact, .alert { background: #222; padding: 10px 14px; border-radius: 8px; color: #ddd; }
    .alert { border-left: 3px solid #ffb300; }
    .funnel { display: flex; flex-direction: column; gap: 6px; color: #ddd; background: #222; padding: 14px; border-radius: 8px; }
    .funnel .hot { color: #64b5f6; font-weight: 700; }
    .open { display: inline-block; background: #1976d2; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; }
    .hint { margin-top: 24px; font-size: 12px; color: #777; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VariantMorningDeskComponent {
  data = input.required<TodayMock>();

  steps(): DeskStep[] {
    return [
      { title: 'Positions first', status: 'now', detail: `${this.data().positions.needingAction} need action`, route: SURFACES.portfolio.route },
      { title: 'Signal funnel', status: 'later', detail: `${this.data().signalFunnel.raw} raw → ${this.data().signalFunnel.actionable} actionable`, route: SURFACES.signalReview.route },
      { title: 'Triggered work', status: 'triggered', detail: `${this.data().orders.queued} order candidates queued`, route: SURFACES.signalOrder.route },
      { title: 'Weekly', status: 'weekly', detail: `Analysis + review due ${this.data().weekly.resultsReviewDue}` },
    ];
  }

  active(): DeskStep {
    return this.steps().find(s => s.status === 'now') ?? this.steps()[0];
  }
}
