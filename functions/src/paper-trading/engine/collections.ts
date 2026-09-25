/**
 * @topic #553 — Paper Trading Infra (task #562)
 *
 * Collection names still in use after the engine migration. Instance /
 * position / stats storage moved to the `paper-trading/{anchor}/items`
 * layout (see `../collections.ts` + `shared/paper-trading-ids.ts`); the
 * instrument map keeps its existing top-level collection.
 */

export const OPTIONS_RH_INSTRUMENT_MAP_COLLECTION = 'options-rh-instrument-map';
