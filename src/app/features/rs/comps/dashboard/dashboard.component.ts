import { ChangeDetectionStrategy, Component } from '@angular/core';

import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';
import { HeatmapComponent } from './heatmap/heatmap.component';

@Component({
	selector: 'rs-dashboard',
	standalone: true,
	imports: [HeatmapComponent],
	templateUrl: './dashboard.component.html',
	styleUrl: './dashboard.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent extends RelStrBaseComponent {
	title = 'rel-str';
}

