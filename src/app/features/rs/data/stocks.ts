import { AMAT, AMAT_DATA, QQQ_AMAT_TARGET_RANKS_WITH_COLORS } from "./AMAT";
import { AAPL, AAPL_DATA, QQQ_AAPL_TARGET_RANKS_WITH_COLORS } from "./AAPL";
import { MSFT, MSFT_DATA, QQQ_MSFT_TARGET_RANKS_WITH_COLORS } from "./MSFT";
import { NVDA, NVDA_DATA, QQQ_NVDA_TARGET_RANKS_WITH_COLORS } from "./NVDA";
import { QQQ, QQQ_DATA } from "./QQQ";
import { QQQ_TSLA_TARGET_RANKS_WITH_COLORS, TSLA, TSLA_DATA } from "./TSLA";
import { BaselineTargetRankDatum, StockData, StockDatum } from "../common/interfaces-rs";

export const ALL_STOCK_DATA: StockData[] = [AMAT_DATA, AAPL_DATA, MSFT_DATA, NVDA_DATA, QQQ_DATA, TSLA_DATA]

export const RAW_STOCK_DATA_BY_SYMBOL: {[key: string]: StockDatum[]} = {
    'AAPL': AAPL,
    'AMAT': AMAT,
    'MSFT': MSFT,
    'NVDA': NVDA,
    'QQQ': QQQ,
    'TSLA': TSLA,

}

export const RANKS_WITH_COLORS_BY_SYMBOL: {[key: string]: BaselineTargetRankDatum[]} = {
    'QQQ_AMAT': QQQ_AMAT_TARGET_RANKS_WITH_COLORS,
    'QQQ_AAPL': QQQ_AAPL_TARGET_RANKS_WITH_COLORS,
    'QQQ_MSFT': QQQ_MSFT_TARGET_RANKS_WITH_COLORS,
    'QQQ_NVDA': QQQ_NVDA_TARGET_RANKS_WITH_COLORS,
    'QQQ_TSLA': QQQ_TSLA_TARGET_RANKS_WITH_COLORS,
}