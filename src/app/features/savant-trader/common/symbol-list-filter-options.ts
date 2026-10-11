/**
 * Shared 'All' sentinel option for SymbolListFilter dropdowns — every
 * surface prepends the same option ahead of its live list groups.
 */
import type { RhSelectOption } from '../components/rh-select-menu/rh-select-menu.component';
import type { SymbolListFilter } from './constants';

export const SYMBOL_LIST_SENTINEL_OPTIONS: RhSelectOption<SymbolListFilter>[] = [
  { value: 'ALL', label: 'All' },
];
