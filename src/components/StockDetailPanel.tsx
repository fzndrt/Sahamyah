import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  ExternalLink,
  Flame,
  Newspaper,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  ForeignFlowManualNote,
  SentimentReport,
  StockAnalysis,
} from '../../shared/idxTypes.ts';
import {
  formatCompactIdr,
  formatRp,
  formatSignedPct,
  getAraStageLabel,
  getManipulationRiskClass,
  getManipulationRiskLabel,
  getSentimentLabel,
  getSentimentTextClass,
  getSignalLabel,
  getSignalTextClass,
  getUrgencyLabel,
  getUrgencyTextClass,
} from '../lib/formatters.ts';
import { CandlestickChart } from './CandlestickChart.tsx';

const FOREIGN_NOTES_KEY = 'pilar_idx_foreign_notes_v1';

function loadForeignNotes(): Record<string, ForeignFlowManualNote> {
  try {
    const raw = localStorage.getItem(FOREIGN_NOTES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

interface StockDetailPanelProps {
  stock: StockAnalysis;
  onAddToPortfolio: (stock: StockAnalysis) => void;
  isTracked: boolean;
}

export function StockDetailPanel({
  stock,
  onAddToPortfolio,
  isTracked,
}: StockDetailPanelProps) {
  const { tradePlan, indicators, araWatch } = stock;

  // News sentiment state (fetched on-demand per selected stock with automatic server failover)
  const [sentiment, setSentiment] = useState<SentimentReport | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);

  // Manual Foreign Flow & Broker Summary confirmation from user's broker app
  const [notesMap, setNotesMap] = useState<Record<string, ForeignFlowManualNote>>(() =>
    loadForeignNotes()
  );

  const currentManualNote: ForeignFlowManualNote = notesMap[stock.symbol] ?? {
    foreignFlow: 'NETRAL',
    brokerFlow: 'CAMPURAN',
    updatedAt: '',
  };

  const updateManualNote = (patch: Partial<ForeignFlowManualNote>) => {
    setNotesMap((prev) => {
      const next: Record<string, ForeignFlowManualNote> = {
        ...prev,
        [stock.symbol]: {
          ...currentManualNote,
          ...patch,
          updatedAt: new Date().toISOString().slice(0, 10),
        },
      };
      try {
        localStorage.setItem(FOREIGN_NOTES_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  useEffect(() => {
    let active = true;
    setSentimentLoading(true);
    setSentiment(null);

    fetch(`/api/market/sentiment?symbol=${encodeURIComponent(stock.symbol)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setSentiment(data as SentimentReport);
        }
      })
      .catch(() => {
        if (active) {
          setSentiment({
            symbol: stock.symbol,
            fetchedAt: new Date().toISOString(),
            provider: 'Fallback Aman',
            overall: 'TIDAK_TERSEDIA',
            score: 0,
            positiveCount: 0,
            negativeCount: 0,
            neutralCount: 0,
            articles: [],
            note: 'Feed berita sementara tidak terjangkau — analisis teknikal & arus uang tetap aktif penuh.',
          });
        }
      })
      .finally(() => {
        if (active) setSentimentLoading(false);
      });

    return () => {
      active = false;
    };
  }, [stock.symbol]);

  // Combined Real-Money Verdict combining Technicals + Anti-Trap + News Sentiment + Manual Foreign/Broker Input
  const realMoneyVerdict = useMemo(() => {
    const hasDistributionFlow =
      currentManualNote.foreignFlow === 'NET_SELL' ||
      currentManualNote.brokerFlow === 'DISTRIBUSI';
    const hasAccumulationFlow =
      currentManualNote.foreignFlow === 'NET_BUY' &&
      currentManualNote.brokerFlow === 'AKUMULASI';
    const negativeNews = sentiment?.overall === 'NEGATIF';

    if (stock.manipulationRisk === 'TINGGI' || stock.signal === 'ALERT_KELUAR') {
      return {
        tone: 'danger' as const,
        title: 'DIBLOKIR / KELUAR — Risiko Jebakan atau Breakdown Aktif',
        detail:
          stock.manipulationFlags[0] ||
          stock.exitWarnings[0]?.detail ||
          'Struktur tidak aman untuk uang riil. Hindari entry baru atau evaluasi keluar segera.',
      };
    }

    if (stock.signal === 'SETUP_BELI' && (hasDistributionFlow || negativeNews)) {
      return {
        tone: 'warn' as const,
        title: 'KONFLIK SINYAL — Tahan Entry / Perkecil Lot',
        detail: hasDistributionFlow
          ? 'Teknikal mendukung beli, namun catatan Asing/Broker Anda menunjukkan distribusi/net sell. Tunggu tekanan jual reda agar tidak menadah guyuran.'
          : 'Teknikal bagus, namun sentimen berita sedang negatif. Cek katalis fundamental sebelum masuk.',
      };
    }

    if (stock.signal === 'SETUP_BELI' && hasAccumulationFlow) {
      return {
        tone: 'good' as const,
        title: 'KONFLUENSI PENUH — Teknikal, Anti-Jebakan & Asing/Broker Searah',
        detail: `Seluruh filter selaras. Masuk bertahap di zona ${formatRp(tradePlan.entryMin)}–${formatRp(tradePlan.entryMax)} dengan Cut Loss wajib ${formatRp(tradePlan.cutLoss)}.`,
      };
    }

    if (stock.signal === 'SETUP_BELI') {
      return {
        tone: 'good' as const,
        title: 'SETUP SWING TERUKUR — Lulus Filter Anti-Jebakan',
        detail: `Periksa Net Foreign & Broker Summary di sekuritas Anda sebelum eksekusi. Selalu batasi risiko 1–2% modal dengan Cut Loss ${formatRp(tradePlan.cutLoss)}.`,
      };
    }

    return {
      tone: 'neutral' as const,
      title: 'TAHAN / PANTAU — Belum Ada Konfluensi Beli Optimal',
      detail:
        'Tidak perlu memaksakan transaksi setiap hari. Tunggu konfirmasi struktur tren, CMF positif, dan rasio Risk/Reward minimal 1:1.8.',
    };
  }, [stock, currentManualNote, sentiment, tradePlan]);

  return (
    <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {stock.symbol}
            </h2>
            <span className="text-sm text-slate-600 dark:text-slate-400">{stock.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{stock.sector}</span>
            <span aria-hidden="true">·</span>
            <span>{stock.trend}</span>
            <span aria-hidden="true">·</span>
            <span className={`font-semibold ${getSignalTextClass(stock.signal)}`}>
              {getSignalLabel(stock.signal)}
            </span>
            <span aria-hidden="true">·</span>
            <span className={`font-medium ${getManipulationRiskClass(stock.manipulationRisk)}`}>
              Risiko Jebakan: {getManipulationRiskLabel(stock.manipulationRisk)}
            </span>
            <span aria-hidden="true">·</span>
            <span>Penutupan {stock.lastDate}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div className="text-right font-mono tabular-nums">
            <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {formatRp(stock.lastClose)}
            </div>
            <div
              className={`text-xs font-medium ${
                stock.changePct >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-700 dark:text-red-400'
              }`}
            >
              {stock.change >= 0 ? '+' : ''}
              {stock.change.toLocaleString('id-ID')} ({formatSignedPct(stock.changePct)})
            </div>
          </div>

          <button
            type="button"
            onClick={() => onAddToPortfolio(stock)}
            className="inline-flex items-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            {isTracked ? 'Tambah Posisi Lagi' : 'Catat ke Portofolio'}
          </button>
        </div>
      </div>

      {/* Real-Money Verdict Banner */}
      <div
        className={`border-b px-6 py-3.5 text-xs ${
          realMoneyVerdict.tone === 'danger'
            ? 'border-red-200 bg-red-50/70 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200'
            : realMoneyVerdict.tone === 'warn'
              ? 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
              : realMoneyVerdict.tone === 'good'
                ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-200'
                : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300'
        }`}
      >
        <div className="font-semibold">{realMoneyVerdict.title}</div>
        <p className="mt-0.5 leading-relaxed opacity-90">{realMoneyVerdict.detail}</p>
      </div>

      {/* Main Split: Chart + Flow + News Left, Trade Plan + Anti-Trap + Checklist Right */}
      <div className="grid grid-cols-1 divide-y divide-slate-200 xl:grid-cols-12 xl:divide-x xl:divide-y-0 dark:divide-slate-800">
        {/* Left Column (7 cols) */}
        <div className="flex flex-col divide-y divide-slate-200 xl:col-span-7 dark:divide-slate-800">
          {/* Candlestick & Institutional Flow Indicators */}
          <div className="p-6">
            <CandlestickChart
              symbol={stock.symbol}
              candles={stock.candles}
              tradePlan={tradePlan}
              showLevels={stock.signal !== 'HINDARI'}
            />

            {/* Institutional Flow & Technical Metrics Grid */}
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-200 pt-5 sm:grid-cols-4 dark:border-slate-800">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">CMF (20) Arus Uang</div>
                <div
                  className={`mt-1 font-mono text-sm font-semibold tabular-nums ${
                    indicators.cmf20 >= 0.05
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : indicators.cmf20 <= -0.05
                        ? 'text-red-700 dark:text-red-400'
                        : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {indicators.cmf20 >= 0 ? '+' : ''}
                  {indicators.cmf20.toFixed(2)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  OBV: {indicators.obvTrend}
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">RSI / MFI (14)</div>
                <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {indicators.rsi14.toFixed(1)} / {indicators.mfi14.toFixed(0)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {indicators.mfi14 > 80
                    ? 'Arus Beli Jenuh'
                    : indicators.mfi14 < 25
                      ? 'Arus Jual Jenuh'
                      : 'Tekanan Seimbang'}
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">RS vs IHSG (20H)</div>
                <div
                  className={`mt-1 font-mono text-sm font-semibold tabular-nums ${
                    (indicators.relativeStrengthVsIhsg20d ?? 0) >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {indicators.relativeStrengthVsIhsg20d !== null
                    ? formatSignedPct(indicators.relativeStrengthVsIhsg20d)
                    : '—'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  VCP Ratio {indicators.vcpRatio.toFixed(2)}
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Rata-Rata Transaksi</div>
                <div
                  className={`mt-1 font-mono text-sm font-semibold tabular-nums ${
                    indicators.avgValue20Idr < 5_000_000_000
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {formatCompactIdr(indicators.avgValue20Idr)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Vol {indicators.volumeRatio.toFixed(2)}x · ATR {indicators.atrPercent.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          {/* Invisible Patterns & ARA Momentum Watch */}
          <div className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Flame className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                Pola Tersembunyi &amp; Radar Momentum ARA BEI
              </h3>
              <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                ARA {formatRp(araWatch.araPriceEstimate)} / ARB {formatRp(araWatch.arbPriceEstimate)}{' '}
                (±{indicators.araLimitPct}%)
              </span>
            </div>

            <div className="mt-3 border border-slate-200 bg-slate-50/70 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  Status Radar ARA: {getAraStageLabel(araWatch.stage)}
                </span>
                {araWatch.expansionStreak > 0 && (
                  <span className="font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                    Streak Ekspansi Kuat: {araWatch.expansionStreak} sesi
                  </span>
                )}
              </div>
              <p className="mt-1 text-slate-700 dark:text-slate-300">{araWatch.headline}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {araWatch.riskNote}
              </p>
            </div>

            {stock.invisiblePatterns.length > 0 ? (
              <ul className="mt-4 space-y-2.5">
                {stock.invisiblePatterns.map((pat) => (
                  <li
                    key={pat.code}
                    className={`border p-3 text-xs ${
                      pat.type === 'JEBAKAN'
                        ? 'border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/25'
                        : pat.type === 'MOMENTUM_ARA'
                          ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/25'
                          : 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/25'
                    }`}
                  >
                    <div
                      className={`font-semibold ${
                        pat.type === 'JEBAKAN'
                          ? 'text-red-800 dark:text-red-300'
                          : pat.type === 'MOMENTUM_ARA'
                            ? 'text-amber-800 dark:text-amber-300'
                            : 'text-emerald-800 dark:text-emerald-300'
                      }`}
                    >
                      [{pat.type === 'JEBAKAN' ? 'JEBAKAN' : pat.type === 'MOMENTUM_ARA' ? 'MOMENTUM' : 'AKUMULASI'}]{' '}
                      {pat.title}
                    </div>
                    <p className="mt-1 leading-relaxed text-slate-700 dark:text-slate-300">
                      {pat.detail}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Tidak ada anomali pola tersembunyi (divergence, churning, atau kompresi ekstrem) yang
                aktif pada sesi terakhir.
              </p>
            )}
          </div>

          {/* Live News Sentiment Panel (Google News ID Primary + Yahoo RSS Failover) */}
          <div className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Newspaper className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                Sentimen Berita Saham Real-Time
              </h3>
              {sentiment && (
                <span className={`text-xs font-semibold ${getSentimentTextClass(sentiment.overall)}`}>
                  {getSentimentLabel(sentiment.overall)}
                  {sentiment.articles.length > 0 && (
                    <span className="ml-1.5 font-mono font-normal text-slate-500 dark:text-slate-400">
                      (+{sentiment.positiveCount} / -{sentiment.negativeCount} / ={sentiment.neutralCount})
                    </span>
                  )}
                </span>
              )}
            </div>

            {sentimentLoading ? (
              <div className="mt-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-9 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800/70"
                  />
                ))}
              </div>
            ) : sentiment && sentiment.articles.length > 0 ? (
              <div className="mt-3 space-y-2.5">
                {sentiment.note && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">{sentiment.note}</p>
                )}
                <ul className="divide-y divide-slate-100 border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {sentiment.articles.slice(0, 5).map((art, i) => (
                    <li key={`${art.link}-${i}`} className="px-3.5 py-2.5 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <a
                          href={art.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-slate-800 hover:underline dark:text-slate-200"
                        >
                          {art.title}
                        </a>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span
                          className={`font-semibold ${
                            art.sentiment === 'POSITIF'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : art.sentiment === 'NEGATIF'
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {art.sentiment}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{art.source}</span>
                        {art.publishedAt && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">{art.publishedAt.slice(0, 10)}</span>
                          </>
                        )}
                        {art.matchedKeywords.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Kata kunci: {art.matchedKeywords.join(', ')}</span>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">
                  Sumber: {sentiment.provider}
                </div>
              </div>
            ) : (
              <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">
                {sentiment?.note ||
                  'Belum ditemukan headline berita terbaru untuk emiten ini pada feed publik.'}
              </p>
            )}
          </div>
        </div>

        {/* Right Column (5 cols): Trade Plan + Manual Foreign Flow + Exit Warnings + 7-Rule Confluence */}
        <div className="flex flex-col divide-y divide-slate-200 xl:col-span-5 dark:divide-slate-800">
          {/* Objective Trade Plan */}
          <div className="p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Rencana Trading Objektif (Fraksi BEI)
              </h3>
              <span className="font-mono text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                R:R 1:{tradePlan.riskRewardRatio.toFixed(2)}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{stock.setupLabel}</p>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <div className="border-b border-slate-100 pb-2 dark:border-slate-800/80">
                <dt className="text-slate-500 dark:text-slate-400">Zona Beli Ideal</dt>
                <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatRp(tradePlan.entryMin)} – {formatRp(tradePlan.entryMax)}
                </dd>
              </div>
              <div className="border-b border-slate-100 pb-2 dark:border-slate-800/80">
                <dt className="text-slate-500 dark:text-slate-400">Batas Cut Loss (Wajib)</dt>
                <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-red-700 dark:text-red-400">
                  {formatRp(tradePlan.cutLoss)}{' '}
                  <span className="text-xs font-normal">(-{tradePlan.riskPct.toFixed(2)}%)</span>
                </dd>
              </div>
              <div className="border-b border-slate-100 pb-2 dark:border-slate-800/80">
                <dt className="text-slate-500 dark:text-slate-400">Target Profit 1 (TP1)</dt>
                <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatRp(tradePlan.tp1)}{' '}
                  <span className="text-xs font-normal">(+{tradePlan.rewardTp1Pct.toFixed(2)}%)</span>
                </dd>
              </div>
              <div className="border-b border-slate-100 pb-2 dark:border-slate-800/80">
                <dt className="text-slate-500 dark:text-slate-400">Target Profit 2 (TP2)</dt>
                <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatRp(tradePlan.tp2)}{' '}
                  <span className="text-xs font-normal">(+{tradePlan.rewardTp2Pct.toFixed(2)}%)</span>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Trailing Stop Dinamis</dt>
                <dd className="mt-0.5 font-mono text-sm font-medium tabular-nums text-amber-700 dark:text-amber-400">
                  {formatRp(tradePlan.trailingStop)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Estimasi Horizon Swing</dt>
                <dd className="mt-0.5 font-mono text-sm font-medium tabular-nums text-slate-700 dark:text-slate-300">
                  {tradePlan.estimatedHorizonDays}
                </dd>
              </div>
            </dl>
          </div>

          {/* Manual Foreign Flow & Broker Summary Verification (from user's broker app) */}
          <div className="p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <ShieldCheck className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                Konfirmasi Asing &amp; Broker (Input Sekuritas)
              </h3>
              {currentManualNote.updatedAt && (
                <span className="font-mono text-[11px] text-slate-400">
                  {currentManualNote.updatedAt}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              Data resmi Net Foreign &amp; Broker Summary BEI hanya ada di aplikasi sekuritas. Catat
              kondisi hari ini untuk memverifikasi sinyal sebelum masuk uang riil.
            </p>

            <div className="mt-3 space-y-2.5 text-xs">
              <div>
                <div className="mb-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Arus Dana Asing (Foreign Flow)
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-800/80">
                  {(
                    [
                      { id: 'NET_BUY', label: 'Net Buy' },
                      { id: 'NETRAL', label: 'Netral' },
                      { id: 'NET_SELL', label: 'Net Sell' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updateManualNote({ foreignFlow: opt.id })}
                      className={`rounded px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        currentManualNote.foreignFlow === opt.id
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Broker Summary (Institusi vs Ritel)
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-800/80">
                  {(
                    [
                      { id: 'AKUMULASI', label: 'Akumulasi' },
                      { id: 'CAMPURAN', label: 'Campuran' },
                      { id: 'DISTRIBUSI', label: 'Distribusi' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updateManualNote({ brokerFlow: opt.id })}
                      className={`rounded px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        currentManualNote.brokerFlow === opt.id
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Early Exit Warning Section */}
          <div className="p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <ShieldAlert className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                Deteksi Dini Sinyal Keluar
              </h3>
              <span className={`text-xs font-semibold ${getUrgencyTextClass(stock.exitUrgency)}`}>
                {getUrgencyLabel(stock.exitUrgency)}
              </span>
            </div>

            {stock.exitWarnings.length > 0 ? (
              <ul className="mt-3 space-y-2.5">
                {stock.exitWarnings.map((warn) => (
                  <li
                    key={warn.code}
                    className="border border-red-200 bg-red-50/60 p-3 text-xs dark:border-red-900/50 dark:bg-red-950/30"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-red-800 dark:text-red-300">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        [{warn.severity}] {warn.title}
                      </span>
                    </div>
                    <p className="mt-1 leading-relaxed text-red-700/90 dark:text-red-300/90">
                      {warn.detail}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Tidak terdeteksi pola distribusi volume tinggi, bull trap, atau breakdown EMA 20.
                Tetap jaga batas Cut Loss di{' '}
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {formatRp(tradePlan.cutLoss)}
                </span>
                .
              </p>
            )}
          </div>

          {/* 7-Rule Transparent Confluence Checklist */}
          <div className="p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Audit 7 Filter Real-Money
              </h3>
              <span className="font-mono text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                {stock.confluencePassed}/{stock.confluenceTotal} lulus
              </span>
            </div>

            <ul className="mt-3 space-y-2">
              {stock.confluenceChecks.map((check) => (
                <li key={check.label} className="flex items-start gap-2.5 text-xs">
                  {check.passed ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                  )}
                  <div>
                    <div
                      className={
                        check.passed
                          ? 'font-medium text-slate-900 dark:text-slate-100'
                          : 'text-slate-500 dark:text-slate-400'
                      }
                    >
                      {check.label}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {check.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
