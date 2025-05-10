import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'rs-chart-two-rs-pane',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chart-two-rs-pane.component.html',
  styleUrl: './chart-two-rs-pane.component.scss'
})
export class ChartTwoRsPaneComponent {
  @Input() rsColors: string[] = [];
}
