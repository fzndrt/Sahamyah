import type {
  AraWatchInfo,
  Candle,
  ConfluenceCheck,
  ExitUrgency,
  ExitWarning,
  IndexSummary,
  InvisiblePattern,
  ManipulationRisk,
  SignalStatus,
  StockAnalysis,
  TechnicalSnapshot,
  TradePlan,
  TrendRegime,
} from './idxTypes.ts';
import { getBeiAraLimitPct, roundToBeiTick } from './idxUniverse.ts';

export interface RawOhlcv {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function calcEmaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let ema = sum / period;
  out[period - 1] = ema;

  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

export function calcRsiSeries(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function calcMacd(closes: number[]): {
  macd: number;
  signal: number;
  histogram: number;
  prevHistogram: number;
} {
  const ema12 = calcEmaSeries(closes, 12);
  const ema26 = calcEmaSeries(closes, 26);
  const macdLine: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    const fast = ema12[i];
    const slow = ema26[i];
    if (fast !== null && slow !== null) {
      macdLine.push(fast - slow);
    }
  }

  if (macdLine.length < 10) {
    return { macd: 0, signal: 0, histogram: 0, prevHistogram: 0 };
  }

  const signalSeries = calcEmaSeries(macdLine, 9);
  const lastIdx = macdLine.length - 1;
  const prevIdx = Math.max(0, lastIdx - 1);

  const macd = macdLine[lastIdx] ?? 0;
  const signal = signalSeries[lastIdx] ?? 0;
  const prevMacd = macdLine[prevIdx] ?? 0;
  const prevSignal = signalSeries[prevIdx] ?? 0;

  return {
    macd,
    signal,
    histogram: macd - signal,
    prevHistogram: prevMacd - prevSignal,
  };
}

export function calcAtr(candles: RawOhlcv[], period = 14): number {
  if (candles.length < period + 1) {
    const last = candles[candles.length - 1];
    return last ? Math.max(1, last.high - last.low) : 0;
  }

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose)
    );
    trs.push(tr);
  }

  let atr = trs.slice(0, period).reduce((acc, v) => acc + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/**
 * Chaikin Money Flow (CMF 20): mengukur akumulasi vs distribusi institusi secara kumulatif.
 * Nilai > +0.08 = akumulasi kuat; < -0.08 = distribusi tersembunyi.
 */
export function calcCmf(candles: RawOhlcv[], period = 20): number {
  const window = candles.slice(-period);
  if (window.length === 0) return 0;

  let mfvSum = 0;
  let volSum = 0;
  for (const c of window) {
    const hlRange = c.high - c.low;
    const mfm = hlRange > 0 ? ((c.close - c.low) - (c.high - c.close)) / hlRange : 0;
    mfvSum += mfm * c.volume;
    volSum += c.volume;
  }
  if (volSum <= 0) return 0;
  return mfvSum / volSum;
}

/**
 * Money Flow Index (MFI 14): RSI berbobot volume untuk mendeteksi arus uang riil.
 */
export function calcMfi(candles: RawOhlcv[], period = 14): number {
  if (candles.length <= period) return 50;
  const slice = candles.slice(-(period + 1));

  let posFlow = 0;
  let negFlow = 0;
  for (let i = 1; i < slice.length; i++) {
    const prevTp = (slice[i - 1].high + slice[i - 1].low + slice[i - 1].close) / 3;
    const curTp = (slice[i].high + slice[i].low + slice[i].close) / 3;
    const rawMoneyFlow = curTp * slice[i].volume;
    if (curTp > prevTp) posFlow += rawMoneyFlow;
    else if (curTp < prevTp) negFlow += rawMoneyFlow;
  }

  if (negFlow === 0) return posFlow > 0 ? 100 : 50;
  const ratio = posFlow / negFlow;
  return 100 - 100 / (1 + ratio);
}

/**
 * On-Balance Volume (OBV) Series
 */
export function calcObvSeries(candles: RawOhlcv[]): number[] {
  const obv: number[] = [];
  let running = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i > 0) {
      if (candles[i].close > candles[i - 1].close) running += candles[i].volume;
      else if (candles[i].close < candles[i - 1].close) running -= candles[i].volume;
    }
    obv.push(running);
  }
  return obv;
}

export function analyzeIndex(raw: RawOhlcv[], symbol: string, name: string): IndexSummary | null {
  if (raw.length < 2) return null;
  const closes = raw.map((c) => c.close);
  const ema20Series = calcEmaSeries(closes, 20);
  const ema50Series = calcEmaSeries(closes, 50);

  const last = raw[raw.length - 1];
  const prev = raw[raw.length - 2];
  const ref20 = raw[Math.max(0, raw.length - 21)];
  const ema20 = ema20Series[raw.length - 1];
  const ema50 = ema50Series[raw.length - 1];

  const change = last.close - prev.close;
  const changePct = prev.close > 0 ? (change / prev.close) * 100 : 0;
  const return20dPct = ref20.close > 0 ? ((last.close - ref20.close) / ref20.close) * 100 : 0;

  let regime: 'Bullish' | 'Sideways' | 'Bearish' = 'Sideways';
  if (ema20 !== null && ema50 !== null) {
    if (last.close > ema20 && ema20 > ema50) regime = 'Bullish';
    else if (last.close < ema20 && ema20 < ema50) regime = 'Bearish';
  }

  return {
    symbol,
    name,
    lastDate: last.date,
    lastClose: Number(last.close.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePct: Number(changePct.toFixed(2)),
    return20dPct: Number(return20dPct.toFixed(2)),
    ema20: ema20 !== null ? Number(ema20.toFixed(2)) : null,
    ema50: ema50 !== null ? Number(ema50.toFixed(2)) : null,
    regime,
  };
}

export function analyzeStock(
  symbol: string,
  yahooTicker: string,
  name: string,
  sector: string,
  raw: RawOhlcv[],
  options?: {
    ihsgReturn20dPct?: number | null;
    dataProvider?: string;
    isStale?: boolean;
  }
): StockAnalysis | null {
  if (raw.length < 35) return null;

  const closes = raw.map((c) => c.close);
  const ema20Series = calcEmaSeries(closes, 20);
  const ema50Series = calcEmaSeries(closes, 50);
  const rsi14Series = calcRsiSeries(closes, 14);
  const obvSeries = calcObvSeries(raw);
  const macdData = calcMacd(closes);
  const atr14 = calcAtr(raw, 14);
  const atr5 = calcAtr(raw.slice(-12), 5);
  const atr20 = calcAtr(raw.slice(-30), 20);
  const cmf20 = calcCmf(raw, 20);
  const mfi14 = calcMfi(raw, 14);

  const lastIdx = raw.length - 1;
  const last = raw[lastIdx];
  const prev = raw[lastIdx - 1];

  const ema20 = ema20Series[lastIdx] ?? last.close;
  const prevEma20 = ema20Series[lastIdx - 1] ?? prev.close;
  const ema50 = ema50Series[lastIdx] ?? ema20;
  const rsi14 = rsi14Series[lastIdx] ?? 50;
  const prevRsi14 = rsi14Series[lastIdx - 1] ?? rsi14;

  // Volume 20-day average & average daily value traded (Rp)
  const volWindow = raw.slice(Math.max(0, lastIdx - 20), lastIdx);
  const volumeMa20 =
    volWindow.length > 0
      ? volWindow.reduce((sum, c) => sum + c.volume, 0) / volWindow.length
      : Math.max(1, last.volume);
  const avgValue20Idr =
    volWindow.length > 0
      ? volWindow.reduce((sum, c) => sum + c.close * c.volume, 0) / volWindow.length
      : last.close * last.volume;
  const volumeRatio = volumeMa20 > 0 ? last.volume / volumeMa20 : 1;

  // OBV 10-day trend
  const obvNow = obvSeries[lastIdx];
  const obv10Ago = obvSeries[Math.max(0, lastIdx - 10)];
  const obvDiff = obvNow - obv10Ago;
  const obvThreshold = volumeMa20 * 0.8;
  const obvTrend: 'Akumulasi' | 'Netral' | 'Distribusi' =
    obvDiff > obvThreshold ? 'Akumulasi' : obvDiff < -obvThreshold ? 'Distribusi' : 'Netral';

  // Relative Strength vs IHSG (20 trading days)
  const ref20 = raw[Math.max(0, lastIdx - 20)];
  const stockReturn20d = ref20.close > 0 ? ((last.close - ref20.close) / ref20.close) * 100 : 0;
  const relativeStrengthVsIhsg20d =
    typeof options?.ihsgReturn20dPct === 'number'
      ? Number((stockReturn20d - options.ihsgReturn20dPct).toFixed(2))
      : null;

  // VCP Volatility Contraction Ratio & Close Location Value (CLV)
  const vcpRatio = atr20 > 0 ? atr5 / atr20 : 1;
  const dayRange = last.high - last.low;
  const closeLocationValue = dayRange > 0 ? (last.close - last.low) / dayRange : 0.5;
  const araLimitPct = getBeiAraLimitPct(prev.close);

  // Swing support / resistance over prior 20 & 10 sessions
  const recent20 = raw.slice(Math.max(0, lastIdx - 19), lastIdx + 1);
  const prior20 = raw.slice(Math.max(0, lastIdx - 20), lastIdx);
  const prior10 = raw.slice(Math.max(0, lastIdx - 10), lastIdx);
  const support20 = Math.min(...recent20.map((c) => c.low));
  const support10 = prior10.length > 0 ? Math.min(...prior10.map((c) => c.low)) : support20;
  const resistance20 = Math.max(...recent20.map((c) => c.high));
  const prevResistance20 = prior20.length > 0 ? Math.max(...prior20.map((c) => c.high)) : resistance20;

  const change = last.close - prev.close;
  const changePct = prev.close > 0 ? (change / prev.close) * 100 : 0;
  const atrPercent = last.close > 0 ? (atr14 / last.close) * 100 : 2;
  const distanceToEma20Pct = ema20 > 0 ? ((last.close - ema20) / ema20) * 100 : 0;
  const distanceToSupportPct = support20 > 0 ? ((last.close - support20) / support20) * 100 : 0;

  const indicators: TechnicalSnapshot = {
    ema20: Number(ema20.toFixed(2)),
    ema50: Number(ema50.toFixed(2)),
    rsi14: Number(rsi14.toFixed(1)),
    macd: Number(macdData.macd.toFixed(2)),
    macdSignal: Number(macdData.signal.toFixed(2)),
    macdHistogram: Number(macdData.histogram.toFixed(2)),
    prevMacdHistogram: Number(macdData.prevHistogram.toFixed(2)),
    atr14: Number(atr14.toFixed(2)),
    atrPercent: Number(atrPercent.toFixed(2)),
    volumeMa20: Math.round(volumeMa20),
    volumeRatio: Number(volumeRatio.toFixed(2)),
    support20: roundToBeiTick(support20, 'floor'),
    resistance20: roundToBeiTick(resistance20, 'ceil'),
    distanceToEma20Pct: Number(distanceToEma20Pct.toFixed(2)),
    distanceToSupportPct: Number(distanceToSupportPct.toFixed(2)),
    cmf20: Number(cmf20.toFixed(3)),
    mfi14: Number(mfi14.toFixed(1)),
    obvTrend,
    relativeStrengthVsIhsg20d,
    avgValue20Idr: Math.round(avgValue20Idr),
    vcpRatio: Number(vcpRatio.toFixed(2)),
    closeLocationValue: Number(closeLocationValue.toFixed(2)),
    araLimitPct,
  };

  // --- Trend Regime Classification ---
  let trend: TrendRegime = 'Konsolidasi';
  if (last.close > ema20 && ema20 > ema50) {
    trend = 'Uptrend Kuat';
  } else if (last.close >= ema50 && last.close <= ema20 * 1.015 && ema20 >= ema50 * 0.99) {
    trend = 'Pullback Sehat';
  } else if (last.close < ema20 && ema20 < ema50) {
    trend = 'Downtrend';
  } else if (last.close < ema20 && macdData.histogram < 0) {
    trend = 'Distribusi / Lemah';
  }

  // --- Invisible Patterns & Anti-Manipulation Guardrails ("Tidak Bisa Dikadalin") ---
  const invisiblePatterns: InvisiblePattern[] = [];
  const manipulationFlags: string[] = [];

  // 1. Divergence Detection (compare recent 5-day window vs prior 6..18-day window)
  const recentWindowStart = Math.max(0, lastIdx - 4);
  const olderWindowStart = Math.max(0, lastIdx - 18);
  const olderWindowEnd = Math.max(olderWindowStart + 1, lastIdx - 5);

  let recentMaxClose = -Infinity;
  let recentMaxRsi = -Infinity;
  let recentMinClose = Infinity;
  let recentMinRsi = Infinity;
  for (let i = recentWindowStart; i <= lastIdx; i++) {
    if (raw[i].close > recentMaxClose) recentMaxClose = raw[i].close;
    if (raw[i].close < recentMinClose) recentMinClose = raw[i].close;
    const r = rsi14Series[i];
    if (r !== null) {
      if (r > recentMaxRsi) recentMaxRsi = r;
      if (r < recentMinRsi) recentMinRsi = r;
    }
  }

  let olderMaxClose = -Infinity;
  let olderMaxRsi = -Infinity;
  let olderMinClose = Infinity;
  let olderMinRsi = Infinity;
  for (let i = olderWindowStart; i <= olderWindowEnd; i++) {
    if (raw[i].close > olderMaxClose) olderMaxClose = raw[i].close;
    if (raw[i].close < olderMinClose) olderMinClose = raw[i].close;
    const r = rsi14Series[i];
    if (r !== null) {
      if (r > olderMaxRsi) olderMaxRsi = r;
      if (r < olderMinRsi) olderMinRsi = r;
    }
  }

  const bearishDivergence =
    recentMaxClose > olderMaxClose * 1.015 &&
    recentMaxRsi < olderMaxRsi - 4 &&
    recentMaxRsi > 52;

  const bullishDivergence =
    recentMinClose < olderMinClose * 0.985 &&
    recentMinRsi > olderMinRsi + 4 &&
    recentMinRsi < 48;

  // 2. Bull Trap / Fake Breakout (guyuran di puncak intraday)
  const bullTrap =
    last.high > prevResistance20 &&
    closeLocationValue < 0.35 &&
    volumeRatio >= 1.35;

  // 3. Silent Institutional Distribution (Churning: volume meledak tapi harga macet/melemah)
  const silentChurning =
    volumeRatio >= 1.9 &&
    changePct < 0.6 &&
    distanceToEma20Pct > 2.0 &&
    closeLocationValue < 0.45;

  // 4. Price rising over 5 days while CMF negative (distribusi halus saat ritel FOMO)
  const price5Ago = raw[Math.max(0, lastIdx - 5)].close;
  const priceUp5d = price5Ago > 0 ? ((last.close - price5Ago) / price5Ago) * 100 : 0;
  const stealthDistribution = priceUp5d > 2.5 && cmf20 < -0.06 && obvTrend === 'Distribusi';

  // 5. Thin Liquidity / Gorengan Risk (< Rp 5 Miliar rata-rata 20H)
  const thinLiquidity = avgValue20Idr < 5_000_000_000;

  // 6. Overextended / FOMO Trap
  const overextendedFomo = distanceToEma20Pct > 12 || rsi14 > 78 || mfi14 > 85;

  // 7. Stealth Institutional Accumulation
  const stealthAccumulation =
    cmf20 >= 0.1 &&
    obvTrend === 'Akumulasi' &&
    mfi14 >= 45 &&
    mfi14 <= 75;

  if (bullTrap) {
    manipulationFlags.push('Jebakan Bull Trap: Breakout intraday gagal & ditutup di area bawah dengan volume tinggi.');
    invisiblePatterns.push({
      code: 'BULL_TRAP',
      type: 'JEBAKAN',
      title: 'Jebakan Bull Trap / Fake Breakout',
      detail: `Harga sempat menembus resistance Rp ${roundToBeiTick(prevResistance20, 'ceil').toLocaleString('id-ID')} lalu dibanting tutup di ${(closeLocationValue * 100).toFixed(0)}% bawah rentang harian (Vol ${volumeRatio.toFixed(2)}x).`,
    });
  }

  if (bearishDivergence) {
    manipulationFlags.push('Bearish Divergence: Harga cetak puncak lebih tinggi namun momentum RSI melemah.');
    invisiblePatterns.push({
      code: 'BEARISH_DIVERGENCE',
      type: 'JEBAKAN',
      title: 'Bearish Divergence Tersembunyi',
      detail: `Harga naik melampaui puncak sebelumnya sementara puncak RSI turun dari ${olderMaxRsi.toFixed(1)} ke ${recentMaxRsi.toFixed(1)} — pola klasik sebelum koreksi tajam.`,
    });
  }

  if (silentChurning || stealthDistribution) {
    manipulationFlags.push('Distribusi Terselubung: Arus uang (CMF/OBV) keluar saat harga tampak ditahan/naik.');
    invisiblePatterns.push({
      code: 'STEALTH_DISTRIBUTION',
      type: 'JEBAKAN',
      title: 'Distribusi Terselubung (Churning)',
      detail: `CMF(20) ${cmf20.toFixed(2)} & OBV ${obvTrend} dengan volume ${volumeRatio.toFixed(2)}x menunjukkan suplai besar dilepas ke pembeli ritel.`,
    });
  }

  if (overextendedFomo) {
    manipulationFlags.push('Area FOMO / Overextended: Jarak harga terlalu jauh dari EMA 20 atau MFI/RSI jenuh beli ekstrem.');
    invisiblePatterns.push({
      code: 'FOMO_OVEREXTENDED',
      type: 'JEBAKAN',
      title: 'Zona Rawan Guyuran (Overextended)',
      detail: `Harga ${distanceToEma20Pct.toFixed(1)}% di atas EMA 20 (RSI ${rsi14.toFixed(1)}, MFI ${mfi14.toFixed(1)}). Jangan mengejar harga di pucuk.`,
    });
  }

  if (thinLiquidity) {
    manipulationFlags.push(`Likuiditas Tipis: Rata-rata transaksi Rp ${(avgValue20Idr / 1e9).toFixed(2)} M/hari (< Rp 5 M) rawan slippage & manipulasi.`);
  }

  if (bullishDivergence) {
    invisiblePatterns.push({
      code: 'BULLISH_DIVERGENCE',
      type: 'AKUMULASI',
      title: 'Bullish Divergence (Akumulasi Bawah)',
      detail: `Harga mencetak low baru namun RSI justru naik (${olderMinRsi.toFixed(1)} -> ${recentMinRsi.toFixed(1)}), menandakan tekanan jual mulai diserap.`,
    });
  }

  if (stealthAccumulation) {
    invisiblePatterns.push({
      code: 'INSTITUTIONAL_ACCUMULATION',
      type: 'AKUMULASI',
      title: 'Jejak Akumulasi Institusi (CMF & OBV Positif)',
      detail: `Chaikin Money Flow +${cmf20.toFixed(2)}, MFI ${mfi14.toFixed(1)}, dan OBV menanjak menandakan penyerapan barang konsisten.`,
    });
  }

  if (relativeStrengthVsIhsg20d !== null && relativeStrengthVsIhsg20d >= 4.0) {
    invisiblePatterns.push({
      code: 'RS_LEADER',
      type: 'AKUMULASI',
      title: 'Unggul di Atas IHSG (Relative Strength)',
      detail: `Performa 20 hari mengungguli IHSG sebesar +${relativeStrengthVsIhsg20d.toFixed(1)}% — ciri khas saham pemimpin sektor.`,
    });
  }

  let manipulationRisk: ManipulationRisk = 'RENDAH';
  if (bullTrap || (bearishDivergence && (silentChurning || stealthDistribution)) || manipulationFlags.length >= 2) {
    manipulationRisk = 'TINGGI';
  } else if (manipulationFlags.length === 1) {
    manipulationRisk = 'SEDANG';
  }

  // --- Early Exit / Breakdown Detection ("Sebelum Harga Longsor") ---
  const exitWarnings: ExitWarning[] = [];

  const brokeBelowEma20 = prev.close >= prevEma20 && last.close < ema20;
  const deepBelowEma20 = distanceToEma20Pct <= -2.5;
  const bearishMacdCross = macdData.prevHistogram >= 0 && macdData.histogram < 0;
  const heavyDistributionDay = changePct <= -2.8 && volumeRatio >= 1.35;
  const sharpDrop = changePct <= -4.0;
  const brokeSupport10 = last.close < support10;
  const rsiRolloverFromOverbought = prevRsi14 >= 68 && rsi14 < prevRsi14 - 3;

  if (brokeSupport10 && volumeRatio >= 1.05) {
    exitWarnings.push({
      code: 'SUPPORT_BREAKDOWN',
      severity: 'KRITIS',
      title: 'Tembus Support 10 Hari',
      detail: `Harga tutup di Rp ${last.close.toLocaleString('id-ID')} (di bawah support Rp ${roundToBeiTick(support10, 'floor').toLocaleString('id-ID')}) dengan volume ${volumeRatio.toFixed(2)}x.`,
    });
  }

  if (heavyDistributionDay || sharpDrop) {
    exitWarnings.push({
      code: 'HEAVY_DISTRIBUTION',
      severity: 'KRITIS',
      title: 'Indikasi Distribusi Berat',
      detail: `Penurunan ${changePct.toFixed(2)}% disertai volume ${volumeRatio.toFixed(2)}x rata-rata 20 hari — tekanan jual masif terdeteksi.`,
    });
  }

  if (bullTrap) {
    exitWarnings.push({
      code: 'BULL_TRAP_EXIT',
      severity: 'KRITIS',
      title: 'Jebakan Bull Trap (Fake Breakout)',
      detail: `Gagal bertahan di atas resistance Rp ${roundToBeiTick(prevResistance20, 'ceil').toLocaleString('id-ID')} disertai guyuran volume ${volumeRatio.toFixed(2)}x.`,
    });
  }

  if (brokeBelowEma20) {
    exitWarnings.push({
      code: 'EMA20_BREAKDOWN',
      severity: 'TINGGI',
      title: 'Breakdown di Bawah EMA 20',
      detail: `Harga menembus ke bawah EMA 20 (Rp ${Math.round(ema20).toLocaleString('id-ID')}), mematahkan struktur swing jangka pendek.`,
    });
  } else if (deepBelowEma20 && last.close < ema50) {
    exitWarnings.push({
      code: 'DOWNTREND_STRUCTURE',
      severity: 'TINGGI',
      title: 'Struktur Downtrend Aktif',
      detail: `Harga ${distanceToEma20Pct.toFixed(1)}% di bawah EMA 20 dan di bawah EMA 50 — risiko penurunan lanjutan tinggi.`,
    });
  }

  if (bearishDivergence) {
    exitWarnings.push({
      code: 'BEARISH_DIV_WARNING',
      severity: 'TINGGI',
      title: 'Peringatan Bearish Divergence',
      detail: `Kenaikan harga tidak didukung momentum RSI/OBV — sering mendahului pembalikan turun mendadak.`,
    });
  }

  if (bearishMacdCross) {
    exitWarnings.push({
      code: 'MACD_BEARISH_CROSS',
      severity: 'TINGGI',
      title: 'MACD Death Cross',
      detail: `Histogram MACD berbalik negatif (${macdData.histogram.toFixed(2)}), menandakan tenaga kenaikan habis.`,
    });
  }

  if (silentChurning || stealthDistribution) {
    exitWarnings.push({
      code: 'STEALTH_DIST_WARN',
      severity: 'WASPADA',
      title: 'Distribusi Halus (CMF Negatif)',
      detail: `CMF(20) ${cmf20.toFixed(2)} menandakan arus keluar tersembunyi di balik pergerakan harga.`,
    });
  }

  if (rsiRolloverFromOverbought) {
    exitWarnings.push({
      code: 'RSI_OVERBOUGHT_ROLLOVER',
      severity: 'WASPADA',
      title: 'RSI Berbalik dari Jenuh Beli',
      detail: `RSI turun dari ${prevRsi14.toFixed(1)} ke ${rsi14.toFixed(1)} — perketat trailing stop untuk mengunci profit.`,
    });
  }

  let exitUrgency: ExitUrgency = 'AMAN';
  if (exitWarnings.some((w) => w.severity === 'KRITIS')) {
    exitUrgency = 'KRITIS';
  } else if (exitWarnings.some((w) => w.severity === 'TINGGI')) {
    exitUrgency = 'TINGGI';
  } else if (exitWarnings.some((w) => w.severity === 'WASPADA')) {
    exitUrgency = 'WASPADA';
  }

  // --- ARA Momentum / Explosive Breakout Radar ---
  const araPriceEstimate = roundToBeiTick(last.close * (1 + getBeiAraLimitPct(last.close) / 100), 'floor');
  const arbPriceEstimate = roundToBeiTick(last.close * (1 - getBeiAraLimitPct(last.close) / 100), 'ceil');

  // Count consecutive or recent strong expansion sessions (close near high + gain >= 3.5%)
  let expansionStreak = 0;
  for (let i = lastIdx; i >= Math.max(1, lastIdx - 4); i--) {
    const c = raw[i];
    const p = raw[i - 1];
    const pct = p.close > 0 ? ((c.close - p.close) / p.close) * 100 : 0;
    const rng = c.high - c.low;
    const clv = rng > 0 ? (c.close - c.low) / rng : 0.5;
    if (pct >= 3.0 && clv >= 0.72) expansionStreak++;
    else break;
  }

  const nearAraToday = changePct >= araLimitPct * 0.75 && closeLocationValue >= 0.85;
  const freshBreakoutSurge =
    last.close > prevResistance20 &&
    volumeRatio >= 1.8 &&
    closeLocationValue >= 0.75 &&
    cmf20 > 0.05 &&
    !bullTrap;
  const vcpSqueezeReady =
    vcpRatio <= 0.78 &&
    last.close >= ema20 &&
    ema20 >= ema50 * 0.99 &&
    cmf20 >= 0.05 &&
    !bullTrap &&
    !thinLiquidity;

  let araWatch: AraWatchInfo = {
    isCandidate: false,
    stage: 'TIDAK',
    araPriceEstimate,
    arbPriceEstimate,
    expansionStreak,
    headline: 'Tidak dalam fase ledakan momentum ekstrem',
    riskNote: `Batas ARA/ARB BEI sesi berikutnya: +/-${getBeiAraLimitPct(last.close)}%.`,
  };

  if (nearAraToday && !thinLiquidity) {
    araWatch = {
      isCandidate: true,
      stage: 'DEKAT_ARA',
      araPriceEstimate,
      arbPriceEstimate,
      expansionStreak: Math.max(1, expansionStreak),
      headline: `Momentum Ekstrem Mendekati ARA (+${changePct.toFixed(1)}% · Close Near High)`,
      riskNote:
        'Risiko sangat tinggi: saham mendekati/menyentuh ARA rawan profit-taking mendadak, ARB berbalik, atau pantauan UMA BEI. Jangan all-in; gunakan ukuran lot kecil & trailing stop ketat.',
    };
    invisiblePatterns.push({
      code: 'NEAR_ARA_LOCK',
      type: 'MOMENTUM_ARA',
      title: 'Daya Beli Terkunci di Puncak (Dekat ARA)',
      detail: `Naik +${changePct.toFixed(1)}% (batas ARA ${araLimitPct}%) dan tutup di ${(closeLocationValue * 100).toFixed(0)}% puncak rentang harian dengan volume ${volumeRatio.toFixed(2)}x.`,
    });
  } else if (freshBreakoutSurge && !thinLiquidity) {
    araWatch = {
      isCandidate: true,
      stage: 'BREAKOUT_KUAT',
      araPriceEstimate,
      arbPriceEstimate,
      expansionStreak,
      headline: `Breakout Resistance 20H + Lonjakan Volume ${volumeRatio.toFixed(2)}x`,
      riskNote:
        'Kandidat ekspansi lanjutan berisiko tinggi. Tidak ada jaminan ARA berulang — wajib disiplin Cut Loss di bawah titik breakout.',
    };
    invisiblePatterns.push({
      code: 'EXPLOSIVE_BREAKOUT',
      type: 'MOMENTUM_ARA',
      title: 'Breakout Ekspansif dengan Konfirmasi Arus Uang',
      detail: `Tembus high 20 hari dengan volume ${volumeRatio.toFixed(2)}x, CLV ${(closeLocationValue * 100).toFixed(0)}%, dan CMF +${cmf20.toFixed(2)}.`,
    });
  } else if (vcpSqueezeReady) {
    araWatch = {
      isCandidate: true,
      stage: 'KOMPRESI_VCP',
      araPriceEstimate,
      arbPriceEstimate,
      expansionStreak,
      headline: `Fase Kompresi Volatilitas (VCP ${vcpRatio.toFixed(2)}) Siap Ekspansi`,
      riskNote:
        'Volatilitas menyempit dengan akumulasi CMF positif — tunggu trigger breakout di atas resistance 20H dengan lonjakan volume.',
    };
    invisiblePatterns.push({
      code: 'VCP_SQUEEZE',
      type: 'MOMENTUM_ARA',
      title: 'Pola Kompresi Volatilitas (VCP Squeeze)',
      detail: `Rasio ATR5/ATR20 menyempit ke ${vcpRatio.toFixed(2)} saat CMF +${cmf20.toFixed(2)} — sering mendahului pergerakan impulsif kuat.`,
    });
  }

  // --- Objective Trade Plan (BEI Tick-Rounded) ---
  const entryMin = roundToBeiTick(Math.min(last.close, Math.max(ema20, last.close - 0.35 * atr14)), 'floor');
  const entryMax = roundToBeiTick(last.close + 0.25 * atr14, 'ceil');
  const entryMid = (entryMin + entryMax) / 2;

  const rawAtrStop = last.close - 1.6 * atr14;
  const rawSupportStop = support10 * 0.985;
  let candidateStop = Math.max(rawAtrStop, rawSupportStop);
  const maxStopAllowed = entryMid * 0.975;
  const minStopAllowed = entryMid * 0.925;
  candidateStop = Math.min(maxStopAllowed, Math.max(minStopAllowed, candidateStop));
  const cutLoss = roundToBeiTick(candidateStop, 'floor');

  const trailingStop = roundToBeiTick(Math.max(cutLoss, ema20 * 0.992), 'floor');
  const riskPerShare = Math.max(1, entryMid - cutLoss);

  const tp1Raw = Math.max(entryMid + riskPerShare * 1.8, resistance20);
  const tp2Raw = entryMid + riskPerShare * 2.8;
  const tp1 = roundToBeiTick(tp1Raw, 'ceil');
  const tp2 = roundToBeiTick(Math.max(tp2Raw, tp1 + riskPerShare * 0.8), 'ceil');

  const riskPct = Number((((entryMid - cutLoss) / entryMid) * 100).toFixed(2));
  const rewardTp1Pct = Number((((tp1 - entryMid) / entryMid) * 100).toFixed(2));
  const rewardTp2Pct = Number((((tp2 - entryMid) / entryMid) * 100).toFixed(2));
  const riskRewardRatio = Number((rewardTp1Pct / Math.max(0.5, riskPct)).toFixed(2));

  const tradePlan: TradePlan = {
    entryMin,
    entryMax,
    cutLoss,
    trailingStop,
    tp1,
    tp2,
    riskPct,
    rewardTp1Pct,
    rewardTp2Pct,
    riskRewardRatio,
    estimatedHorizonDays: atrPercent >= 2.8 ? '3–7 hari bursa' : '5–12 hari bursa',
  };

  // --- 7 Transparent Real-Money Confluence Rules (including Institutional Flow & Anti-Trap) ---
  const trendCheck = last.close >= ema20 * 0.995 && ema20 >= ema50 * 0.99;
  const momentumCheck = macdData.histogram > macdData.prevHistogram && macdData.histogram >= -0.5;
  const rsiHealthyCheck = rsi14 >= 45 && rsi14 <= 68;
  const flowCheck = cmf20 >= 0.02 && obvTrend !== 'Distribusi' && !thinLiquidity;
  const noOverextensionCheck = distanceToEma20Pct >= -1.5 && distanceToEma20Pct <= 7.0;
  const riskRewardCheck = riskRewardRatio >= 1.8 && riskPct <= 7.5;
  const antiTrapCheck = manipulationRisk === 'RENDAH' && !bullTrap && !bearishDivergence;

  const confluenceChecks: ConfluenceCheck[] = [
    {
      label: 'Struktur Tren Bullish (EMA 20 >= EMA 50)',
      passed: trendCheck,
      detail: `Close Rp ${last.close.toLocaleString('id-ID')} vs EMA20 Rp ${Math.round(ema20).toLocaleString('id-ID')} / EMA50 Rp ${Math.round(ema50).toLocaleString('id-ID')}`,
    },
    {
      label: 'Arus Uang & Likuiditas Institusi (CMF & OBV)',
      passed: flowCheck,
      detail: `CMF(20) ${cmf20 >= 0 ? '+' : ''}${cmf20.toFixed(2)} · OBV ${obvTrend} · Avg Transaksi Rp ${(avgValue20Idr / 1e9).toFixed(1)} M/hari`,
    },
    {
      label: 'Momentum MACD Menguat',
      passed: momentumCheck,
      detail: `Histogram ${macdData.prevHistogram.toFixed(2)} -> ${macdData.histogram.toFixed(2)}`,
    },
    {
      label: 'RSI & MFI Zona Sehat (Bukan Pucuk FOMO)',
      passed: rsiHealthyCheck && mfi14 <= 78,
      detail: `RSI(14) ${rsi14.toFixed(1)} · MFI(14) ${mfi14.toFixed(1)}`,
    },
    {
      label: 'Harga Tidak Overextended dari EMA 20',
      passed: noOverextensionCheck,
      detail: `Jarak ke EMA 20: ${distanceToEma20Pct >= 0 ? '+' : ''}${distanceToEma20Pct.toFixed(2)}% (zona aman -1.5% s/d +7.0%)`,
    },
    {
      label: 'Rasio Risk/Reward Disiplin (>= 1:1.8)',
      passed: riskRewardCheck,
      detail: `R:R 1:${riskRewardRatio.toFixed(2)} dengan batas cut loss ${riskPct.toFixed(2)}%`,
    },
    {
      label: 'Lulus Filter Anti-Jebakan (Bebas Bull Trap & Divergence)',
      passed: antiTrapCheck,
      detail:
        manipulationFlags.length === 0
          ? 'Tidak ada pola jebakan, distribusi terselubung, atau likuiditas tipis'
          : manipulationFlags[0],
    },
  ];

  const confluencePassed = confluenceChecks.filter((c) => c.passed).length;

  // --- Final Signal Classification (HARD GUARDRAILS FOR REAL MONEY) ---
  let signal: SignalStatus = 'PANTAU';
  let setupLabel = 'Konsolidasi — Tunggu Konfirmasi';

  if (exitUrgency === 'KRITIS' || bullTrap || (exitUrgency === 'TINGGI' && confluencePassed <= 3)) {
    signal = 'ALERT_KELUAR';
    setupLabel = bullTrap
      ? 'Jebakan Bull Trap Diblokir — Waspada Guyuran'
      : exitUrgency === 'KRITIS'
        ? 'Sinyal Keluar Kritis — Risiko Breakdown'
        : 'Waspada Distribusi — Perketat Stop Loss';
  } else if (manipulationRisk === 'TINGGI' || thinLiquidity) {
    signal = 'HINDARI';
    setupLabel = thinLiquidity
      ? 'Diblokir Filter Likuiditas (< Rp 5 M/hari)'
      : 'Diblokir Filter Anti-Jebakan — Risiko Manipulasi Tinggi';
  } else if (confluencePassed >= 6 && exitUrgency === 'AMAN' && antiTrapCheck) {
    signal = 'SETUP_BELI';
    setupLabel =
      araWatch.stage === 'BREAKOUT_KUAT'
        ? 'Breakout Ekspansif + Akumulasi Institusi'
        : distanceToEma20Pct <= 2.5
          ? 'Buy on Pullback EMA 20 (Akumulasi Sehat)'
          : 'Trend Continuation Swing Terkonfirmasi';
  } else if (
    confluencePassed === 5 &&
    trendCheck &&
    flowCheck &&
    antiTrapCheck &&
    exitUrgency === 'AMAN'
  ) {
    signal = 'SETUP_BELI';
    setupLabel = 'Setup Swing Terukur (Konfirmasi Bertahap)';
  } else if (trend === 'Downtrend') {
    signal = 'HINDARI';
    setupLabel = 'Tren Turun — Hindari Entry Baru';
  } else if (exitUrgency === 'WASPADA' || manipulationRisk === 'SEDANG') {
    signal = 'PANTAU';
    setupLabel = 'Ada Catatan Risiko — Tunggu Konfirmasi Bersih';
  }

  // Last 65 trading sessions for candlestick chart
  const chartStart = Math.max(0, raw.length - 65);
  const candles: Candle[] = raw.slice(chartStart).map((c, offset) => {
    const idx = chartStart + offset;
    return {
      date: c.date,
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      ema20: ema20Series[idx] !== null ? Number(ema20Series[idx]!.toFixed(2)) : null,
      ema50: ema50Series[idx] !== null ? Number(ema50Series[idx]!.toFixed(2)) : null,
      rsi14: rsi14Series[idx] !== null ? Number(rsi14Series[idx]!.toFixed(1)) : null,
    };
  });

  return {
    symbol,
    yahooTicker,
    name,
    sector,
    lastDate: last.date,
    lastClose: last.close,
    prevClose: prev.close,
    change: Number(change.toFixed(2)),
    changePct: Number(changePct.toFixed(2)),
    dayHigh: last.high,
    dayLow: last.low,
    volume: last.volume,
    valueTradedIdr: Math.round(last.close * last.volume),
    trend,
    signal,
    exitUrgency,
    setupLabel,
    confluencePassed,
    confluenceTotal: confluenceChecks.length,
    confluenceChecks,
    exitWarnings,
    manipulationRisk,
    manipulationFlags,
    invisiblePatterns,
    araWatch,
    indicators,
    tradePlan,
    candles,
    dataProvider: options?.dataProvider ?? 'Yahoo Finance Q1',
    isStale: options?.isStale ?? false,
  };
}
