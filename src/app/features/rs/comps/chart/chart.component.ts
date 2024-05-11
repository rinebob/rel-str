import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'rs-chart',
  standalone: true,
  imports: [],
  templateUrl: './chart.component.html',
  styleUrl: './chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChartComponent {

}
