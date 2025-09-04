import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'rs-chart-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chart-toolbar.component.html',
  styleUrls: ['./chart-toolbar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChartToolbarComponent {
  /**
   * Indicates whether the subset of data is currently being used.
   */
  @Input() useDataSubset = false;

  /**
   * Current zoom factor (fraction of chart shown, 0 < zoomFactor <= 1)
   */
  @Input() zoomFactor: number = 1;

  /**
   * Current zoom position (start of zoom window, 0 <= zoomPosition <= 1-zoomFactor)
   */
  @Input() zoomPosition: number = 0;

  /**
   * Emits when the Zoom In button is clicked
   */
  @Output() zoomIn = new EventEmitter<void>();
  /**
   * Emits when the Zoom Out button is clicked
   */
  @Output() zoomOut = new EventEmitter<void>();
  /**
   * Emits when the Reset Zoom button is clicked
   */
  @Output() resetZoom = new EventEmitter<void>();
  /**
   * Emits when the Use Subset button is clicked
   */
  @Output() useSubset = new EventEmitter<void>();
  /**
   * Emits when the Go To Start button is clicked
   */
  @Output() goToStart = new EventEmitter<void>();
  /**
   * Emits when the Go To End button is clicked
   */
  @Output() goToEnd = new EventEmitter<void>();


  /**
   * Handler for Zoom In button
   */
  public onZoomIn(): void {
    this.zoomIn.emit();
  }
  /**
   * Handler for Zoom Out button
   */
  public onZoomOut(): void {
    this.zoomOut.emit();
  }
  /**
   * Handler for Reset Zoom button
   */
  public onResetZoom(): void {
    this.resetZoom.emit();
  }
  /**
   * Handler for Use Subset button
   */
  public onUseSubset(): void {
    this.useSubset.emit();
  }
  /**
   * Handler for Go To Start button
   */
  public onGoToStart(): void {
    this.goToStart.emit();
  }
  /**
   * Handler for Go To End button
   */
  public onGoToEnd(): void {
    this.goToEnd.emit();
  }
}

