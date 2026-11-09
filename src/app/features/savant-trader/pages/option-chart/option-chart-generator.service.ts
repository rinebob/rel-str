/**
 * Generator drawer wiring — drawer open state, study-range brush →
 * alive-range bound, and the drawer's send handoff into the load flow.
 * Page-scoped: provided by the component, dies with the page.
 */
import { Injectable, inject, signal } from '@angular/core';

import { OptionGroupGeneratorStore } from '../../stores/option-group-generator.store';
import type { StudyRange } from '../../utils/option-group-generator.utils';
import { OptionChartLoadService } from './option-chart-load.service';

@Injectable()
export class OptionChartGeneratorService {
  private readonly genStore = inject(OptionGroupGeneratorStore);
  private readonly load = inject(OptionChartLoadService);

  /** Whether the right group-generator drawer is open. */
  generatorOpen = false;

  /** Arms the study-range brush on the contract chart; Esc disarms. */
  readonly brushArmed = signal(false);

  /** Chart brush (#1340) → generator alive-range bound — wired through
   *  the component's (studyRange) output, so it must exist before the
   *  chart's first brush emission. */
  onStudyRange(range: StudyRange | null): void {
    this.genStore.applyRange(range);
  }

  /** Header-button × — clears the alive-range bound (chart band + drawer
   *  row go away, persisted blob updates) and disarms the brush. */
  clearStudyRange(): void {
    this.brushArmed.set(false);
    this.genStore.applyRange(null);
  }

  /** Drawer handoff — emitted pair lines go through the same textarea +
   *  loadPlotted path as a paste, so replace semantics stay identical. */
  onGeneratorSend(lines: string[]): void {
    this.load.emitLinesToChart(lines);
  }
}
