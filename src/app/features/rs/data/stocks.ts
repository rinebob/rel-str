import { AMAT_DATA } from "./AMAT";
import { AAPL_DATA } from "./AAPL";
import { MSFT_DATA } from "./MSFT";
import { NVDA_DATA } from "./NVDA";
import { QQQ_DATA } from "./QQQ";
import { TSLA_DATA } from "./TSLA";
import { StockData } from "../common/interfaces-rs";

export const ALL_STOCK_DATA: StockData[] = [AMAT_DATA, AAPL_DATA, MSFT_DATA, NVDA_DATA, QQQ_DATA, TSLA_DATA]