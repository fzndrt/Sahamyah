import { AlertTriangle, ArrowRight, ShieldAlert } from 'lucide-react';
import { useMemo } from 'react';
import type { PortfolioPosition, StockAnalysis } from '../../shared/idxTypes.ts';
import {
  formatRp,
  formatSignedPct,
  getManipulationRiskClass,
  getManipulationRiskLabel,
  getUrgencyLabel,
  getUrgencyTextClass,
} from '../lib/formatters.ts';

interface ExitAlertViewProps {
  stocks: StockAnalysis[];
  positions: PortfolioPosition[];
  onInspectStock: (stock: StockAnalysis) => void;
  onGoToPortfolio: () => void;
}

interface PositionAlertEval {
  position: PortfolioPosition;
  market: StockAnalysis | null;
  status: 'CUT_LOSS_BREACHED' | 'NEAR_CUT_LOSS' | 'BREAKDOWN_WARNING' | 'TAKE_PROFIT' | 'SAFE';
  headline: string;
  actionNote: string;
  pnlPct: number | null;
  pnlIdr: number | null;
}

export function ExitAlertView({
  stocks,
  positions,
  onInspectStock,
  onGoToPortfolio,
}: ExitAlertViewProps) {
  const stockMap = useMemo(() => new Map(stocks.map((s) => [s.symbol, s])), [stocks]);

  const positionEvaluations = useMemo<PositionAlertEval[]>(() => {
    return positions.map((pos) => {
      const market = stockMap.get(pos.symbol) ?? null;
      if (!market) {
        return {
          position: pos,
          market: null,
          status: 'SAFE',
          headline: 'Menunggu data harga terbaru',
          actionNote: 'Klik Pindai Pasar atau cek emiten di menu Screener.',
          pnlPct: null,
          pnlIdr: null,
        };
      }

      const shares = pos.lots * 100;
      const pnlIdr = (market.lastClose - pos.entryPrice) * shares;
      const pnlPct = ((market.lastClose - pos.entryPrice) / pos.entryPrice) * 100;
      const distToClPct = ((market.lastClose - pos.cutLoss) / market.lastClose) * 100;

      if (market.lastClose <= pos.cutLoss) {
        return {
          position: pos,
          market,
          status: 'CUT_LOSS_BREACHED',
          headline: 'KRITIS — Harga Menembus Batas Cut Loss',
          actionNote: `Harga saat ini (${formatRp(market.lastClose)}) berada di bawah Cut Loss rencana (${formatRp(pos.cutLoss)}). Eksekusi keluar disiplin untuk mencegah kerugian lebih dalam.`,
          pnlPct,
          pnlIdr,
        };
      }

      if (
        market.exitUrgency === 'KRITIS' ||
        market.exitUrgency === 'TINGGI' ||
        market.manipulationRisk === 'TINGGI'
      ) {
        return {
          position: pos,
          market,
          status: 'BREAKDOWN_WARNING',
          headline: `PERINGATAN DINI — ${market.exitWarnings[0]?.title || market.manipulationFlags[0] || 'Distribusi / Jebakan'}`,
          actionNote:
            market.exitWarnings[0]?.detail ||
            market.manipulationFlags[0] ||
            'Struktur harga atau arus uang mulai melemah. Pertimbangkan kurangi posisi atau naikkan batas keluar.',
          pnlPct,
          pnlIdr,
        };
      }

      if (distToClPct <= 2.2) {
        return {
          position: pos,
          market,
          status: 'NEAR_CUT_LOSS',
          headline: `WASPADA — Jarak ke Cut Loss Tinggal ${distToClPct.toFixed(1)}%`,
          actionNote: `Siapkan order otomatis Cut Loss di ${formatRp(pos.cutLoss)} agar tidak terlambat jika tekanan jual meningkat.`,
          pnlPct,
          pnlIdr,
        };
      }

      if (market.lastClose >= pos.targetProfit) {
        return {
          position: pos,
          market,
          status: 'TAKE_PROFIT',
          headline: 'TARGET TERCAPAI — Kunci Profit / Aktifkan Trailing Stop',
          actionNote: `Harga (${formatRp(market.lastClose)}) telah melewati Target (${formatRp(pos.targetProfit)}). Amankan profit sebagian atau geser trailing stop ke EMA 20 (${formatRp(market.indicators.ema20)}).`,
          pnlPct,
          pnlIdr,
        };
      }

      return {
        position: pos,
        market,
        status: 'SAFE',
        headline: 'Posisi Masih Dalam Struktur Aman',
        actionNote: `Pertahankan disiplin Cut Loss di ${formatRp(pos.cutLoss)} dan pantau EMA 20 (${formatRp(market.indicators.ema20)}) serta CMF (${market.indicators.cmf20.toFixed(2)}).`,
        pnlPct,
        pnlIdr,
      };
    });
  }, [positions, stockMap]);

  const marketExitRadar = useMemo(() => {
    const rank = { KRITIS: 3, TINGGI: 2, WASPADA: 1, AMAN: 0 };
    const manipRank = { TINGGI: 2, SEDANG: 1, RENDAH: 0 };
    return stocks
      .filter(
        (s) =>
          s.exitUrgency !== 'AMAN' ||
          s.exitWarnings.length > 0 ||
          s.manipulationRisk === 'TINGGI'
      )
      .sort((a, b) => {
        const diff = rank[b.exitUrgency] - rank[a.exitUrgency];
        if (diff !== 0) return diff;
        const mDiff = manipRank[b.manipulationRisk] - manipRank[a.manipulationRisk];
        if (mDiff !== 0) return mDiff;
        return a.changePct - b.changePct;
      });
  }, [stocks]);

  return (
    <div className="space-y-6">
      {/* Section 1: User Active Positions Exit Monitor */}
      <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Monitor Proteksi Posisi Aktif Anda
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Membandingkan harga pasar terakhir dengan Cut Loss, Trailing Stop EMA 20, deteksi
              bull trap, dan arus uang CMF/OBV pada saham yang Anda pegang.
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToPortfolio}
            className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            Kelola Portofolio
          </button>
        </div>

        {positionEvaluations.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Belum ada posisi aktif yang dicatat.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Tambahkan saham yang sedang Anda pegang di menu Portofolio &amp; Risiko agar sistem
              memberi peringatan keluar otomatis sebelum harga menyentuh area longsor.
            </p>
            <button
              type="button"
              onClick={onGoToPortfolio}
              className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Catat Posisi Pertama
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {positionEvaluations.map((ev) => {
              const isDanger =
                ev.status === 'CUT_LOSS_BREACHED' || ev.status === 'BREAKDOWN_WARNING';
              const isWarn = ev.status === 'NEAR_CUT_LOSS';
              const isTp = ev.status === 'TAKE_PROFIT';

              return (
                <div
                  key={ev.position.id}
                  className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                        {ev.position.symbol}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {ev.position.lots} lot @ {formatRp(ev.position.entryPrice)}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono tabular-nums text-red-700 dark:text-red-400">
                        CL {formatRp(ev.position.cutLoss)}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                        TP {formatRp(ev.position.targetProfit)}
                      </span>
                    </div>

                    <div
                      className={`flex items-center gap-1.5 text-xs font-semibold ${
                        isDanger
                          ? 'text-red-700 dark:text-red-400'
                          : isWarn
                            ? 'text-amber-700 dark:text-amber-400'
                            : isTp
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {(isDanger || isWarn) && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                      <span>{ev.headline}</span>
                    </div>

                    <p className="max-w-3xl text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {ev.actionNote}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-6 lg:justify-end">
                    {ev.market && ev.pnlPct !== null && ev.pnlIdr !== null && (
                      <div className="text-right font-mono tabular-nums">
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {formatRp(ev.market.lastClose)}
                        </div>
                        <div
                          className={`text-xs font-medium ${
                            ev.pnlIdr >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-700 dark:text-red-400'
                          }`}
                        >
                          {ev.pnlIdr >= 0 ? '+' : ''}
                          {formatRp(ev.pnlIdr)} ({formatSignedPct(ev.pnlPct)})
                        </div>
                      </div>
                    )}

                    {ev.market && (
                      <button
                        type="button"
                        onClick={() => onInspectStock(ev.market!)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-950 whitespace-nowrap shrink-0 dark:text-slate-300 dark:hover:text-white"
                      >
                        Grafik
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Market-Wide Breakdown, Bull Trap & Distribution Radar */}
      <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" />
            Radar Distribusi, Jebakan Bull Trap &amp; Sinyal Keluar IDX ({marketExitRadar.length}{' '}
            emiten)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Mendeteksi breakdown support 10 hari, breakdown EMA 20, jebakan bull trap, bearish
            divergence tersembunyi, dan distribusi halus (CMF negatif) sebelum penurunan makin dalam.
          </p>
        </div>

        {marketExitRadar.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Tidak ada sinyal breakdown, bull trap, atau distribusi berat yang terdeteksi saat ini.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {marketExitRadar.map((stock) => (
              <div
                key={stock.symbol}
                className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-start lg:justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                      {stock.symbol}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">{stock.name}</span>
                    <span className="text-slate-400">·</span>
                    <span className={`font-semibold ${getUrgencyTextClass(stock.exitUrgency)}`}>
                      {getUrgencyLabel(stock.exitUrgency)}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span
                      className={`font-medium ${getManipulationRiskClass(stock.manipulationRisk)}`}
                    >
                      Risiko Jebakan: {getManipulationRiskLabel(stock.manipulationRisk)}
                    </span>
                  </div>

                  <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                    {stock.exitWarnings.map((w) => (
                      <li key={w.code}>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          [{w.severity}] {w.title}:
                        </span>{' '}
                        {w.detail}
                      </li>
                    ))}
                    {stock.exitWarnings.length === 0 &&
                      stock.manipulationFlags.map((flag, i) => (
                        <li key={i}>
                          <span className="font-semibold text-red-700 dark:text-red-400">
                            [ANTI-JEBAKAN]
                          </span>{' '}
                          {flag}
                        </li>
                      ))}
                  </ul>
                </div>

                <div className="flex items-center justify-between gap-6 lg:shrink-0">
                  <div className="text-right font-mono tabular-nums">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {formatRp(stock.lastClose)}
                    </div>
                    <div
                      className={`text-xs font-medium ${
                        stock.changePct >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {formatSignedPct(stock.changePct)} · CMF{' '}
                      {stock.indicators.cmf20 >= 0 ? '+' : ''}
                      {stock.indicators.cmf20.toFixed(2)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onInspectStock(stock)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Periksa Grafik
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
