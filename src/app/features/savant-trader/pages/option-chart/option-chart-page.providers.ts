/**
 * Page-scoped provider set for the option-chart page — one instance of
 * each coordination unit + the two page-scoped stores per page; dies
 * with the page, never root-provided. Specs spread this same list in
 * TestBed so manual component instantiation resolves the same injects.
 *
 * Lives in its own file so the services can import the page service
 * without a module cycle through this array.
 */
import type { Provider } from '@angular/core';

import { OptionGroupGeneratorStore } from '../../stores/option-group-generator.store';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';
import { OptionChartPageService } from './option-chart-page.service';
import { OptionChartCatalogService } from './option-chart-catalog.service';
import { OptionChartLoadService } from './option-chart-load.service';
import { OptionChartListService } from './option-chart-list.service';
import { OptionChartReplayService } from './option-chart-replay.service';
import { OptionChartGeneratorService } from './option-chart-generator.service';

export const OPTION_CHART_PAGE_PROVIDERS: Provider[] = [
  OptionGroupGeneratorStore,
  ContractListSessionStore,
  OptionChartPageService,
  OptionChartCatalogService,
  OptionChartLoadService,
  OptionChartListService,
  OptionChartReplayService,
  OptionChartGeneratorService,
];
