export type StrategyName = "rsi-oversold" | "macd-crossover" | "dip-buy" | "custom";

export interface WatchedSymbol {
  symbol: string;
  strategy: StrategyName;
  amount: number;
  intervalMs: number;
  enabled: boolean;
  customPrompt?: string;
}

export const watchlist: WatchedSymbol[] = [
  {
    symbol: "AAPL",
    strategy: "rsi-oversold",
    amount: 100,
    intervalMs: 5 * 60 * 1000,
    enabled: true,
  },
  {
    symbol: "NVDA",
    strategy: "macd-crossover",
    amount: 200,
    intervalMs: 15 * 60 * 1000,
    enabled: true,
  },
  {
    symbol: "TSLA",
    strategy: "dip-buy",
    amount: 150,
    intervalMs: 10 * 60 * 1000,
    enabled: false,
  },
];
