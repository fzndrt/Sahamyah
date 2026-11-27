import { ArrowUpDown, Search } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { MarketScanResponse, SignalStatus, StockAnalysis } from '../../shared/idxTypes.ts';
import {
  formatRp,
  formatSignedPct,
  formatWibTime,
  getAraStageLabel,
  getManipulationRiskClass,
  getManipulationRiskLabel,
  getSignalLabel,
  getSignalTextClass,
  getUrgencyTextClass,
} from '../lib/formatters.ts';
import { StockDetailPanel } from './StockDetailPanel.tsx';

type FilterTab = 'ALL' | SignalStatus | 'ARA_WATCH';
type SortKey = 'signal' | 'changePct' | 'confluence' | 'cmf20' | 'riskReward' | 'volumeRatio';

interface ScreenerViewProps {
  scanData: MarketScanResponse | null;
  loading: boolean;
  error: string | null;
  selectedStock: StockAnalysis | null;
  onSelectStock: (stock: StockAnalysis) => void;
  onLookupCustomSymbol: (symbol: string) => Promise<void>;
  customLookupLoading: boolean;
  customLookupError: string | null;
  onAddToPortfolio: (stock: StockAnalysis) => void;
  trackedSymbols: Set<string>;
  onRetry: () => void;
}

export function ScreenerView({
  scanData,
  loading,
  error,
  selectedStock,
  onSelectStock,
  onLookupCustomSymbol,
  customLookupLoading,
  customLookupError,
  onAddToPortfolio,
  trackedSymbols,
  onRetry,
}: ScreenerViewProps) {
  const [filterTab, setFilterTab] = useState<FilterTab>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('signal');
  const [sortDesc, setSortDesc] = useState(true);
  const [customTickerInput, setCustomTickerInput] = useState('');

  const sectors = useMemo(() => {
    if (!scanData) return [];
    return Array.from(new Set(scanData.stocks.map((s) => s.sector))).sort();
  }, [scanData]);

  const filteredStocks = useMemo(() => {
    if (!scanData) return [];
    const q = searchQuery.trim().toLowerCase();

    const list = scanData.stocks.filter((s) => {
      if (filterTab === 'ARA_WATCH') {
        if (!s.araWatch.isCandidate) return false;
      } else if (filterTab !== 'ALL' && s.signal !== filterTab) {
        return false;
      }
      if (sectorFilter !== 'ALL' && s.sector !== sectorFilter) return false;
      if (q && !s.symbol.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    const signalRank: Record<SignalStatus, number> = {
      SETUP_BELI: 4,
      ALERT_KELUAR: 3,
      PANTAU: 2,
      HINDARI: 1,
    };

    return [...list].sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case 'signal':
          diff = signalRank[a.signal] - signalRank[b.signal];
          if (diff === 0) diff = a.confluencePassed - b.confluencePassed;
          break;
        case 'changePct':
          diff = a.changePct - b.changePct;
          break;
        case 'confluence':
          diff = a.confluencePassed - b.confluencePassed;
          break;
        case 'cmf20':
          diff = a.indicators.cmf20 - b.indicators.cmf20;
          break;
        case 'riskReward':
          diff = a.tradePlan.riskRewardRatio - b.tradePlan.riskRewardRatio;
          break;
        case 'volumeRatio':
          diff = a.indicators.volumeRatio - b.indicators.volumeRatio;
          break;
      }
      return sortDesc ? -diff : diff;
    });
  }, [scanData, filterTab, searchQuery, sectorFilter, sortKey, sortDesc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const handleCustomLookup = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = customTickerInput.trim().toUpperCase();
    if (!cleaned) return;
    await onLookupCustomSymbol(cleaned);
    setCustomTickerInput('');
  };

  if (loading && !scanData) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 divide-y divide-slate-200 border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-5">
              <div className="h-3 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              <div className="mt-3 h-7 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              <div className="mt-2 h-3 w-40 animate-pulse rounded bg-slate-100 dark:bg-slate-800/60" />
            </div>
          ))}
        </div>
        <div className="border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800/70"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error && !scanData) {
    return (
      <div className="border border-red-200 bg-white p-8 dark:border-red-900/60 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-red-700 dark:text-red-400">
          Gagal Memuat Data Pasar IDX
        </h2>
        <p className="mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
        >
          Coba Pindai Ulang
        </button>
      </div>
    );
  }

  const ihsg = scanData?.ihsg ?? null;
  const summary = scanData?.summary;

  return (
    <div className="space-y-6">
      {/* 4-Column Market & Anti-Trap Summary Strip */}
      <div className="grid grid-cols-1 divide-y divide-slate-200 border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Indeks IHSG (^JKSE)
          </div>
          <div className="mt-1.5 flex items-baseline gap-2.5 font-mono tabular-nums">
            <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {ihsg ? ihsg.lastClose.toLocaleString('id-ID', { minimumFractionDigits: 2 }) : '—'}
            </span>
            {ihsg && (
              <span
                className={`text-xs font-semibold ${
                  ihsg.changePct >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {formatSignedPct(ihsg.changePct)}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {ihsg ? `Tren ${ihsg.regime} · 20H ${formatSignedPct(ihsg.return20dPct)}` : 'Data indeks tidak tersedia'}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Setup Beli (Lulus Anti-Jebakan)
          </div>
          <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {summary?.setupBeliCount ?? 0} emiten
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Radar ARA / Breakout: {summary?.araWatchCount ?? 0} kandidat
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Alert Keluar &amp; Filter Jebakan
          </div>
          <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-red-700 dark:text-red-400">
            {summary?.alertKeluarCount ?? 0} alert
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {summary?.trapBlockedCount ?? 0} emiten terdeteksi pola jebakan / distribusi
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Status Data &amp; Failover
          </div>
          <div className="mt-1.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {scanData ? formatWibTime(scanData.scannedAt) : '—'}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {summary?.totalScanned ?? 0} emiten ·{' '}
            {scanData?.stale
              ? 'Cache cadangan aktif'
              : scanData?.failoverUsed
                ? 'Failover Q2 aktif'
                : 'Jalur utama + Q2 siap'}
          </div>
        </div>
      </div>

      {/* Responsible Anti-Manipulation & Failover Note */}
      <div className="border border-slate-200 bg-white px-5 py-3.5 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          Proteksi Uang Riil &amp; Anti-Jebakan:
        </span>{' '}
        Setiap emiten melewati 7 filter (Tren EMA, CMF/OBV Arus Uang, MACD, RSI/MFI, R:R &ge; 1:1.8,
        Likuiditas &ge; Rp 5 M/hari, dan Blokir Bull Trap/Bearish Divergence). Tidak ada jaminan
        saham pasti naik atau ARA berulang — gunakan Radar ARA hanya dengan disiplin Cut Loss ketat.
        {scanData?.stale && (
          <span className="ml-2 font-medium text-amber-700 dark:text-amber-400">
            ({scanData.providerNotes})
          </span>
        )}
      </div>

      {/* Screener Filter Bar + Custom Ticker Lookup */}
      <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800">
          {/* Segmented Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-800/80">
            {(
              [
                { id: 'ALL', label: `Semua (${scanData?.stocks.length ?? 0})` },
                { id: 'SETUP_BELI', label: `Setup Beli (${summary?.setupBeliCount ?? 0})` },
                { id: 'ARA_WATCH', label: `Radar ARA (${summary?.araWatchCount ?? 0})` },
                { id: 'ALERT_KELUAR', label: `Alert Keluar (${summary?.alertKeluarCount ?? 0})` },
                { id: 'PANTAU', label: `Pantau (${summary?.pantauCount ?? 0})` },
              ] as Array<{ id: FilterTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filterTab === tab.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search, Sector & Custom IDX Ticker Lookup */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter tabel..."
                aria-label="Filter daftar saham"
                className="w-36 rounded-md border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              aria-label="Filter sektor BEI"
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="ALL">Semua Sektor</option>
              {sectors.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>

            <form onSubmit={handleCustomLookup} className="flex items-center gap-1.5">
              <input
                type="text"
                maxLength={7}
                value={customTickerInput}
                onChange={(e) => setCustomTickerInput(e.target.value.toUpperCase())}
                placeholder="Cek emiten (mis. GOTO)"
                aria-label="Cek kode saham IDX lain"
                className="w-40 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={customLookupLoading || !customTickerInput.trim()}
                className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {customLookupLoading ? 'Memuat...' : 'Analisis'}
              </button>
            </form>
          </div>
        </div>

        {customLookupError && (
          <div className="border-b border-red-200 bg-red-50/70 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {customLookupError}
          </div>
        )}

        {/* High-Density Screener Table */}
        <div className="max-h-[410px] overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Emiten</th>
                <th className="px-3 py-2.5 text-right font-semibold">Harga</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('changePct')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    1H %
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2.5 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('signal')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    Sinyal &amp; Radar
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('cmf20')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    CMF 20H
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2.5 font-semibold">Anti-Jebakan</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('confluence')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    Filter
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">Cut Loss</th>
                <th className="px-3 py-2.5 text-right font-semibold">TP 1</th>
                <th className="px-4 py-2.5 text-right font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('volumeRatio')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    Vol Ratio
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredStocks.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    Tidak ada emiten yang cocok dengan filter saat ini.
                  </td>
                </tr>
              ) : (
                filteredStocks.map((stock) => {
                  const isSelected = selectedStock?.symbol === stock.symbol;
                  return (
                    <tr
                      key={stock.symbol}
                      onClick={() => onSelectStock(stock)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-slate-100/90 dark:bg-slate-800/80'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {stock.symbol}
                        </div>
                        <div className="max-w-[155px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {stock.sector}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                        {formatRp(stock.lastClose)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-medium tabular-nums ${
                          stock.changePct >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {formatSignedPct(stock.changePct)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className={`font-semibold ${getSignalTextClass(stock.signal)}`}>
                          {getSignalLabel(stock.signal)}
                          {stock.araWatch.isCandidate && (
                            <span className="ml-2 font-normal text-amber-700 dark:text-amber-400">
                              · {getAraStageLabel(stock.araWatch.stage)}
                            </span>
                          )}
                          {!stock.araWatch.isCandidate && stock.exitUrgency !== 'AMAN' && (
                            <span
                              className={`ml-2 font-normal ${getUrgencyTextClass(stock.exitUrgency)}`}
                            >
                              · {stock.exitUrgency}
                            </span>
                          )}
                        </div>
                        <div className="max-w-[230px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {stock.setupLabel}
                        </div>
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-medium tabular-nums ${
                          stock.indicators.cmf20 >= 0.05
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : stock.indicators.cmf20 <= -0.05
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {stock.indicators.cmf20 >= 0 ? '+' : ''}
                        {stock.indicators.cmf20.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`font-medium ${getManipulationRiskClass(stock.manipulationRisk)}`}
                        >
                          {getManipulationRiskLabel(stock.manipulationRisk)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {stock.confluencePassed}/{stock.confluenceTotal}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-red-700 dark:text-red-400">
                        {stock.tradePlan.cutLoss.toLocaleString('id-ID')}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                        {stock.tradePlan.tp1.toLocaleString('id-ID')}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {stock.indicators.volumeRatio.toFixed(2)}x
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Stock Deep-Dive Panel */}
      {selectedStock && (
        <StockDetailPanel
          stock={selectedStock}
          onAddToPortfolio={onAddToPortfolio}
          isTracked={trackedSymbols.has(selectedStock.symbol)}
        />
      )}
    </div>
  );
}
