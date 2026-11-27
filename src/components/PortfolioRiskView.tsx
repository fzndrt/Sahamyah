import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { PortfolioPosition, StockAnalysis } from '../../shared/idxTypes.ts';
import { getBeiTickSize, normalizeIdxSymbol, roundToBeiTick } from '../../shared/idxUniverse.ts';
import { formatRp, formatSignedPct } from '../lib/formatters.ts';

interface PortfolioRiskViewProps {
  stocks: StockAnalysis[];
  positions: PortfolioPosition[];
  onAddPosition: (pos: Omit<PortfolioPosition, 'id'>) => void;
  onRemovePosition: (id: string) => void;
  prefillStock: StockAnalysis | null;
}

export function PortfolioRiskView({
  stocks,
  positions,
  onAddPosition,
  onRemovePosition,
  prefillStock,
}: PortfolioRiskViewProps) {
  // Position Sizing Calculator State
  const [capital, setCapital] = useState(50_000_000);
  const [riskPct, setRiskPct] = useState(1.5);
  const [calcSymbol, setCalcSymbol] = useState(prefillStock?.symbol ?? 'BBCA');
  const [calcEntry, setCalcEntry] = useState(prefillStock?.lastClose ?? 9500);
  const [calcCutLoss, setCalcCutLoss] = useState(prefillStock?.tradePlan.cutLoss ?? 9100);
  const [calcTarget, setCalcTarget] = useState(prefillStock?.tradePlan.tp1 ?? 10300);
  const [formError, setFormError] = useState<string | null>(null);

  const stockMap = useMemo(() => new Map(stocks.map((s) => [s.symbol, s])), [stocks]);

  const applyStockPreset = (symbol: string) => {
    setCalcSymbol(symbol);
    const found = stockMap.get(symbol);
    if (found) {
      setCalcEntry(found.lastClose);
      setCalcCutLoss(found.tradePlan.cutLoss);
      setCalcTarget(found.tradePlan.tp1);
    }
  };

  const sizing = useMemo(() => {
    const safeCapital = Math.max(0, capital);
    const safeRiskPct = Math.max(0.1, Math.min(10, riskPct));
    const entry = roundToBeiTick(Math.max(50, calcEntry));
    const cutLoss = roundToBeiTick(Math.max(50, calcCutLoss), 'floor');
    const target = roundToBeiTick(Math.max(50, calcTarget), 'ceil');
    const tickSize = getBeiTickSize(entry);

    const maxRiskIdr = (safeCapital * safeRiskPct) / 100;
    const riskPerShare = entry - cutLoss;
    const rewardPerShare = target - entry;

    if (riskPerShare <= 0) {
      return {
        valid: false,
        tickSize,
        entry,
        cutLoss,
        target,
        maxRiskIdr,
        recommendedLots: 0,
        positionValue: 0,
        allocationPct: 0,
        actualRiskIdr: 0,
        estNetProfitIdr: 0,
        riskReward: 0,
      };
    }

    // Include BEI standard broker fee (~0.15% buy + 0.25% sell = 0.40% roundtrip)
    const feePerShare = entry * 0.004;
    const effectiveRiskPerShare = riskPerShare + feePerShare;
    const maxSharesByRisk = Math.floor(maxRiskIdr / effectiveRiskPerShare);
    const maxSharesByCapital = Math.floor(safeCapital / (entry * 1.0015));
    const allowedShares = Math.min(maxSharesByRisk, maxSharesByCapital);
    const recommendedLots = Math.max(0, Math.floor(allowedShares / 100));

    const actualShares = recommendedLots * 100;
    const positionValue = actualShares * entry;
    const allocationPct = safeCapital > 0 ? (positionValue / safeCapital) * 100 : 0;
    const actualRiskIdr = actualShares * effectiveRiskPerShare;
    const estNetProfitIdr = actualShares * (rewardPerShare - feePerShare);
    const riskReward = rewardPerShare > 0 ? rewardPerShare / riskPerShare : 0;

    return {
      valid: true,
      tickSize,
      entry,
      cutLoss,
      target,
      maxRiskIdr,
      recommendedLots,
      positionValue,
      allocationPct,
      actualRiskIdr,
      estNetProfitIdr,
      riskReward,
    };
  }, [capital, riskPct, calcEntry, calcCutLoss, calcTarget]);

  const handleSavePosition = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const normalized = normalizeIdxSymbol(calcSymbol);
    if (!normalized) {
      setFormError('Kode saham harus 4 huruf/angka BEI (contoh: BBCA, BMRI, ADRO).');
      return;
    }
    if (!sizing.valid || sizing.recommendedLots <= 0) {
      setFormError('Pastikan Harga Cut Loss lebih rendah dari Harga Beli dan modal mencukupi minimal 1 lot.');
      return;
    }

    onAddPosition({
      symbol: normalized,
      entryPrice: sizing.entry,
      lots: sizing.recommendedLots,
      cutLoss: sizing.cutLoss,
      targetProfit: sizing.target,
      entryDate: new Date().toISOString().slice(0, 10),
    });
  };

  const totalPortfolioSummary = useMemo(() => {
    let totalCost = 0;
    let totalMarket = 0;
    let totalRiskAtCl = 0;

    positions.forEach((p) => {
      const shares = p.lots * 100;
      const cost = p.entryPrice * shares;
      const live = stockMap.get(p.symbol)?.lastClose ?? p.entryPrice;
      totalCost += cost;
      totalMarket += live * shares;
      totalRiskAtCl += Math.max(0, p.entryPrice - p.cutLoss) * shares;
    });

    const pnl = totalMarket - totalCost;
    const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
    return { totalCost, totalMarket, pnl, pnlPct, totalRiskAtCl };
  }, [positions, stockMap]);

  return (
    <div className="space-y-6">
      {/* Position Sizing Calculator */}
      <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Kalkulator Manajemen Risiko &amp; Ukuran Lot BEI
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Menghitung jumlah lot maksimal secara disiplin berdasarkan batas risiko per transaksi
            (aturan 1%–2%), fraksi harga BEI otomatis, dan estimasi fee sekuritas 0,40% pulang-pergi.
          </p>
        </div>

        <form
          onSubmit={handleSavePosition}
          className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-slate-800"
        >
          {/* Left Inputs */}
          <div className="space-y-4 p-6 lg:col-span-7">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Total Modal Trading (Rp)
                </label>
                <input
                  type="number"
                  min={1_000_000}
                  step={1_000_000}
                  value={capital}
                  onChange={(e) => setCapital(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Risiko Maksimal per Trade (%)
                </label>
                <input
                  type="number"
                  min={0.25}
                  max={5}
                  step={0.25}
                  value={riskPct}
                  onChange={(e) => setRiskPct(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Rekomendasi profesional: 1,0% – 2,0% per posisi.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Kode Emiten IDX
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    type="text"
                    maxLength={4}
                    value={calcSymbol}
                    onChange={(e) => setCalcSymbol(e.target.value.toUpperCase())}
                    className="w-24 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <select
                    value={stockMap.has(calcSymbol) ? calcSymbol : ''}
                    onChange={(e) => e.target.value && applyStockPreset(e.target.value)}
                    aria-label="Pilih preset harga dari hasil screener"
                    className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-700 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  >
                    <option value="">Isi otomatis dari screener...</option>
                    {stocks.map((s) => (
                      <option key={s.symbol} value={s.symbol}>
                        {s.symbol} — {formatRp(s.lastClose)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Harga Beli / Entry (Fraksi Rp {sizing.tickSize})
                </label>
                <input
                  type="number"
                  min={50}
                  step={sizing.tickSize}
                  value={calcEntry}
                  onChange={(e) => setCalcEntry(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Harga Cut Loss (Rp)
                </label>
                <input
                  type="number"
                  min={50}
                  step={sizing.tickSize}
                  value={calcCutLoss}
                  onChange={(e) => setCalcCutLoss(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm tabular-nums text-red-700 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-red-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Harga Target Profit (Rp)
                </label>
                <input
                  type="number"
                  min={50}
                  step={sizing.tickSize}
                  value={calcTarget}
                  onChange={(e) => setCalcTarget(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm tabular-nums text-emerald-700 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-emerald-400"
                />
              </div>
            </div>

            {formError && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">{formError}</p>
            )}
          </div>

          {/* Right Calculated Output */}
          <div className="flex flex-col justify-between p-6 lg:col-span-5">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Ukuran Posisi Disiplin (1 Lot = 100 Lembar)
              </div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {sizing.valid ? `${sizing.recommendedLots.toLocaleString('id-ID')} lot` : 'Invalid'}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Nilai posisi {formatRp(sizing.positionValue)} ({sizing.allocationPct.toFixed(1)}%
                dari modal)
              </div>

              <dl className="mt-5 space-y-2.5 border-t border-slate-200 pt-4 text-xs dark:border-slate-800">
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Risiko Maksimal (+ fee)</dt>
                  <dd className="font-mono font-semibold tabular-nums text-red-700 dark:text-red-400">
                    -{formatRp(sizing.actualRiskIdr)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Estimasi Profit di Target</dt>
                  <dd className="font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    +{formatRp(Math.max(0, sizing.estNetProfitIdr))}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">Rasio Risk / Reward</dt>
                  <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    1 : {sizing.riskReward.toFixed(2)}
                  </dd>
                </div>
              </dl>
            </div>

            <button
              type="submit"
              disabled={!sizing.valid || sizing.recommendedLots <= 0}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              <Plus className="h-3.5 w-3.5" />
              Simpan ke Tracker &amp; Aktifkan Alert Keluar
            </button>
          </div>
        </form>
      </section>

      {/* Active Portfolio Tracker Table */}
      <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Posisi Swing Aktif ({positions.length})
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Tersimpan lokal di browser Anda dan otomatis dipantau oleh menu Alert Keluar.
            </p>
          </div>

          {positions.length > 0 && (
            <div className="flex flex-wrap items-center gap-5 font-mono text-xs tabular-nums">
              <div>
                <span className="text-slate-500 dark:text-slate-400">Nilai Pasar </span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatRp(totalPortfolioSummary.totalMarket)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Unrealized P&amp;L </span>
                <span
                  className={`font-semibold ${
                    totalPortfolioSummary.pnl >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {totalPortfolioSummary.pnl >= 0 ? '+' : ''}
                  {formatRp(totalPortfolioSummary.pnl)} (
                  {formatSignedPct(totalPortfolioSummary.pnlPct)})
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Total Risiko CL </span>
                <span className="font-semibold text-red-700 dark:text-red-400">
                  -{formatRp(totalPortfolioSummary.totalRiskAtCl)}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-6 py-2.5 font-semibold">Emiten</th>
                <th className="px-3 py-2.5 text-right font-semibold">Lot</th>
                <th className="px-3 py-2.5 text-right font-semibold">Harga Beli</th>
                <th className="px-3 py-2.5 text-right font-semibold">Harga Pasar</th>
                <th className="px-3 py-2.5 text-right font-semibold">Cut Loss</th>
                <th className="px-3 py-2.5 text-right font-semibold">Target</th>
                <th className="px-3 py-2.5 text-right font-semibold">P&amp;L</th>
                <th className="px-6 py-2.5 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {positions.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    Belum ada posisi tercatat. Gunakan kalkulator di atas atau klik &ldquo;Catat ke
                    Portofolio&rdquo; pada saham di Screener.
                  </td>
                </tr>
              ) : (
                positions.map((pos) => {
                  const market = stockMap.get(pos.symbol);
                  const current = market?.lastClose ?? pos.entryPrice;
                  const pnlIdr = (current - pos.entryPrice) * pos.lots * 100;
                  const pnlPct = ((current - pos.entryPrice) / pos.entryPrice) * 100;
                  const breachedCl = current <= pos.cutLoss;

                  return (
                    <tr key={pos.id}>
                      <td className="px-6 py-3">
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {pos.symbol}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Masuk {pos.entryDate}
                          {breachedCl && (
                            <span className="ml-2 font-semibold text-red-600 dark:text-red-400">
                              · TEMBUS CUT LOSS
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {pos.lots}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {formatRp(pos.entryPrice)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                        {formatRp(current)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-red-700 dark:text-red-400">
                        {formatRp(pos.cutLoss)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                        {formatRp(pos.targetProfit)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-mono font-medium tabular-nums ${
                          pnlIdr >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {pnlIdr >= 0 ? '+' : ''}
                        {formatRp(pnlIdr)} ({formatSignedPct(pnlPct)})
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onRemovePosition(pos.id)}
                          aria-label={`Hapus posisi ${pos.symbol}`}
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Tutup
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
