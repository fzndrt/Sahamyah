export type SignalStatus = 'SETUP_BELI' | 'ALERT_KELUAR' | 'PANTAU' | 'HINDARI';

export type ExitUrgency = 'KRITIS' | 'TINGGI' | 'WASPADA' | 'AMAN';

export type ManipulationRisk = 'RENDAH' | 'SEDANG' | 'TINGGI';

export type TrendRegime =
  | 'Uptrend Kuat'
  | 'Pullback Sehat'
  | 'Konsolidasi'
  | 'Distribusi / Lemah'
  | 'Downtrend';

export interface Candle {
  date: string; // YYYY-MM-DD
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
}

export interface TechnicalSnapshot {
  ema20: number;
  ema50: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  prevMacdHistogram: number;
  atr14: number;
  atrPercent: number;
  volumeMa20: number;
  volumeRatio: number;
  support20: number;
  resistance20: number;
  distanceToEma20Pct: number;
  distanceToSupportPct: number;
  // Institutional flow & invisible pattern proxies
  cmf20: number; // Chaikin Money Flow (-1..+1)
  mfi14: number; // Money Flow Index (0..100)
  obvTrend: 'Akumulasi' | 'Netral' | 'Distribusi';
  relativeStrengthVsIhsg20d: number | null; // % alpha vs IHSG 20 sessions
  avgValue20Idr: number; // Average daily transaction value (Rp)
  vcpRatio: number; // ATR5 / ATR20 (< 0.78 indicates volatility contraction squeeze)
  closeLocationValue: number; // 0..1 position of close within day's high-low
  araLimitPct: number; // Official BEI Auto Rejection limit (35, 25, or 20)
}

export interface TradePlan {
  entryMin: number;
  entryMax: number;
  cutLoss: number;
  trailingStop: number;
  tp1: number;
  tp2: number;
  riskPct: number;
  rewardTp1Pct: number;
  rewardTp2Pct: number;
  riskRewardRatio: number;
  estimatedHorizonDays: string;
}

export interface ConfluenceCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface ExitWarning {
  code: string;
  severity: 'KRITIS' | 'TINGGI' | 'WASPADA';
  title: string;
  detail: string;
}

export interface InvisiblePattern {
  code: string;
  type: 'AKUMULASI' | 'JEBAKAN' | 'MOMENTUM_ARA';
  title: string;
  detail: string;
}

export interface AraWatchInfo {
  isCandidate: boolean;
  stage: 'TIDAK' | 'KOMPRESI_VCP' | 'BREAKOUT_KUAT' | 'DEKAT_ARA';
  araPriceEstimate: number;
  arbPriceEstimate: number;
  expansionStreak: number;
  headline: string;
  riskNote: string;
}

export interface StockAnalysis {
  symbol: string;
  yahooTicker: string;
  name: string;
  sector: string;
  lastDate: string;
  lastClose: number;
  prevClose: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  valueTradedIdr: number;
  trend: TrendRegime;
  signal: SignalStatus;
  exitUrgency: ExitUrgency;
  setupLabel: string;
  confluencePassed: number;
  confluenceTotal: number;
  confluenceChecks: ConfluenceCheck[];
  exitWarnings: ExitWarning[];
  manipulationRisk: ManipulationRisk;
  manipulationFlags: string[];
  invisiblePatterns: InvisiblePattern[];
  araWatch: AraWatchInfo;
  indicators: TechnicalSnapshot;
  tradePlan: TradePlan;
  candles: Candle[];
  dataProvider: string;
  isStale: boolean;
}

export interface IndexSummary {
  symbol: string;
  name: string;
  lastDate: string;
  lastClose: number;
  change: number;
  changePct: number;
  return20dPct: number;
  ema20: number | null;
  ema50: number | null;
  regime: 'Bullish' | 'Sideways' | 'Bearish';
}

export interface MarketScanResponse {
  scannedAt: string;
  source: string;
  cached: boolean;
  stale: boolean;
  failoverUsed: boolean;
  providerNotes: string;
  ihsg: IndexSummary | null;
  stocks: StockAnalysis[];
  failedSymbols: string[];
  summary: {
    totalScanned: number;
    setupBeliCount: number;
    alertKeluarCount: number;
    pantauCount: number;
    araWatchCount: number;
    trapBlockedCount: number;
  };
}

export interface NewsArticle {
  title: string;
  link: string;
  publishedAt: string;
  source: string;
  sentiment: 'POSITIF' | 'NETRAL' | 'NEGATIF';
  matchedKeywords: string[];
}

export interface SentimentReport {
  symbol: string;
  fetchedAt: string;
  provider: string;
  overall: 'POSITIF' | 'NETRAL' | 'NEGATIF' | 'TIDAK_TERSEDIA';
  score: number; // -100 to +100
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  articles: NewsArticle[];
  note?: string;
}

export interface ForeignFlowManualNote {
  foreignFlow: 'NET_BUY' | 'NETRAL' | 'NET_SELL';
  brokerFlow: 'AKUMULASI' | 'CAMPURAN' | 'DISTRIBUSI';
  updatedAt: string;
}

export interface PortfolioPosition {
  id: string;
  symbol: string;
  entryPrice: number;
  lots: number;
  cutLoss: number;
  targetProfit: number;
  entryDate: string;
  notes?: string;
}

export interface CronScanReport {
  ok: boolean;
  executedAt: string;
  stale: boolean;
  failoverUsed: boolean;
  ihsg: IndexSummary | null;
  buySetups: Array<{
    symbol: string;
    lastClose: number;
    changePct: number;
    setupLabel: string;
    entryMin: number;
    entryMax: number;
    cutLoss: number;
    tp1: number;
    tp2: number;
    riskRewardRatio: number;
    confluence: string;
    cmf20: number;
    manipulationRisk: ManipulationRisk;
  }>;
  araWatchCandidates: Array<{
    symbol: string;
    lastClose: number;
    changePct: number;
    stage: AraWatchInfo['stage'];
    headline: string;
    araPriceEstimate: number;
  }>;
  exitAlerts: Array<{
    symbol: string;
    lastClose: number;
    changePct: number;
    exitUrgency: ExitUrgency;
    manipulationRisk: ManipulationRisk;
    reasons: string[];
  }>;
  notifications: {
    telegramSent: boolean;
    discordSent: boolean;
    message?: string;
  };
}
