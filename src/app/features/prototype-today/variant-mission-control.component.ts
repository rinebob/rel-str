// PROTOTYPE — throwaway variant B for the "Today" surface. Delete after decision.
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TodayMock, SURFACES } from './prototype-today.data';

@Component({
  selector: 'rs-proto-variant-mission-control',
  imports: [RouterLink],
  template: `
    <div class="grid">
      <div class="tile hot">
        <div class="tile-label">Positions</div>
        <div class="tile-big">{{ data().positions.needingAction }}</div>
        <div class="tile-sub">{{ data().positions.total }} open — {{ data().positions.needingAction }} need action</div>
        <a [routerLink]="surfaces.portfolio.route">{{ surfaces.portfolio.label }} →</a>
      </div>
      <div class="tile hot">
        <div class="tile-label">Signal funnel</div>
        <div class="tile-big">{{ data().signalFunnel.raw }}→{{ data().signalFunnel.actionable }}</div>
        <div class="tile-sub">watchlist {{ data().signalFunnel.watchlist }} · tf {{ data().signalFunnel.timeframe }} · dir {{ data().signalFunnel.direction }}</div>
        <a [routerLink]="surfaces.signalReview.route">{{ surfaces.signalReview.label }} →</a>
      </div>
      <div class="tile">
        <div class="tile-label">Decisions</div>
        <div class="tile-big">{{ data().decisions.pending }}</div>
        <div class="tile-sub">pending — live {{ data().decisions.live }} · paper {{ data().decisions.paper }} · decline {{ data().decisions.decline }}</div>
        <a [routerLink]="surfaces.chartReview.route">{{ surfaces.chartReview.label }} →</a>
      </div>
      <div class="tile">
        <div class="tile-label">Orders</div>
        <div class="tile-big">{{ data().orders.queued }}</div>
        <div class="tile-sub">queued · submitted {{ data().orders.submittedToday }} · filled {{ data().orders.fillsToday }}</div>
        <a [routerLink]="surfaces.signalOrder.route">{{ surfaces.signalOrder.label }} →</a>
      </div>
      <div class="tile">
        <div class="tile-label">Paper</div>
        <div class="tile-big">·</div>
        <div class="tile-sub">cohorts + exits monitored here</div>
        <a [routerLink]="surfaces.paperTrading.route">{{ surfaces.paperTrading.label }} →</a>
      </div>
      <div class="tile weekly">
        <div class="tile-label">Weekly</div>
        <div class="tile-sub">Strategy analysis — due {{ data().weekly.strategyAnalysisDue }}</div>
        <div class="tile-sub">Results review — due {{ data().weekly.resultsReviewDue }}</div>
      </div>
    </div>
    <p class="hint">No imposed order — every tile is a doorway. Red/hot tiles are what actually needs you today.</p>
  `,
  styles: [`
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 24px; }
    .tile { background: #1c1c1c; border: 1px solid #333; border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 8px; }
    .tile.hot { border-color: #b71c1c88; }
    .tile.weekly { border-style: dashed; }
    .tile-label { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; }
    .tile-big { font-size: 40px; font-weight: 700; color: #eee; }
    .tile.hot .tile-big { color: #ef9a9a; }
    .tile-sub { font-size: 13px; color: #aaa; }
    a { color: #64b5f6; text-decoration: none; font-size: 14px; margin-top: auto; }
    .hint { padding: 0 24px 24px; font-size: 12px; color: #777; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VariantMissionControlComponent {
  data = input.required<TodayMock>();
  surfaces = SURFACES;
}
