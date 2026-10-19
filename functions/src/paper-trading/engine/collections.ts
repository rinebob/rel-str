/**
 * @topic #553 — Paper Trading Infra (task #562)
 *
 * Collection names still in use after the engine migration. Position /
 * stats storage lives on `st-paper-trading/{anchor}/items` since #1007
 * (instances stay on the legacy root — see `../collections.ts` for the
 * routed seam); the instrument map keeps its existing top-level
 * collection.
 */

export const OPTIONS_RH_INSTRUMENT_MAP_COLLECTION = 'options-rh-instrument-map';
