import {
  Activity,
  Briefcase,
  Menu,
  Moon,
  RefreshCw,
  Server,
  ShieldAlert,
  Sun,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  MarketScanResponse,
  PortfolioPosition,
  StockAnalysis,
} from '../shared/idxTypes.ts';
import { DeployCronView } from './components/DeployCronView.tsx';
import { ExitAlertView } from './components/ExitAlertView.tsx';
import { PortfolioRiskView } from './components/PortfolioRiskView.tsx';
import { ScreenerView } from './components/ScreenerView.tsx';

type NavTab = 'screener' | 'alerts' | 'portfolio' | 'deploy';

const PORTFOLIO_STORAGE_KEY = 'pilar_idx_positions_v1';
const THEME_STORAGE_KEY = 'pilar_idx_theme_v1';
const LAST_SCAN_STORAGE_KEY = 'pilar_idx_last_scan_v1';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof Activity }> = [
  { id: 'screener', label: 'Screener Swing', icon: Activity },
  { id: 'alerts', label: 'Alert Keluar', icon: ShieldAlert },
  { id: 'portfolio', label: 'Portofolio & Risiko', icon: Briefcase },
  { id: 'deploy', label: 'Deploy & Cronjob', icon: Server },
];

function loadSavedPositions(): PortfolioPosition[] {
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadCachedScanFallback(): MarketScanResponse | null {
  try {
    const raw = localStorage.getItem(LAST_SCAN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MarketScanResponse;
    if (!parsed || !Array.isArray(parsed.stocks) || parsed.stocks.length === 0) return null;
    return {
      ...parsed,
      cached: true,
      stale: true,
      failoverUsed: true,
      providerNotes:
        'Jalur API sedang tidak dapat dijangkau — menampilkan data terakhir tersimpan di browser Anda.',
    };
  } catch {
    return null;
  }
}

async function safeParseJson<T>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('screener');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
    } catch {
      return false;
    }
  });

  const [scanData, setScanData] = useState<MarketScanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const [customLookupLoading, setCustomLookupLoading] = useState(false);
  const [customLookupError, setCustomLookupError] = useState<string | null>(null);

  const [positions, setPositions] = useState<PortfolioPosition[]>(() => loadSavedPositions());
  const [prefillStock, setPrefillStock] = useState<StockAnalysis | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, darkMode ? 'dark' : 'light');
    } catch {
      // ignore storage quota errors
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(positions));
    } catch {
      // ignore storage quota errors
    }
  }, [positions]);

  const fetchMarketScan = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const url = forceRefresh ? '/api/market/scan?refresh=1' : '/api/market/scan';
      const res = await fetch(url);
      const data = await safeParseJson<MarketScanResponse & { error?: string }>(res);
      if (!res.ok || !data || !Array.isArray(data.stocks)) {
        throw new Error(data?.error || `Gagal mengambil data pasar (HTTP ${res.status})`);
      }

      setScanData(data);
      setSelectedSymbol((prev) => {
        if (prev && data.stocks.some((s) => s.symbol === prev)) return prev;
        return data.stocks[0]?.symbol ?? null;
      });

      // Save slimmed snapshot in localStorage as client-side final failover
      try {
        localStorage.setItem(LAST_SCAN_STORAGE_KEY, JSON.stringify(data));
      } catch {
        // ignore storage quota overflow
      }
    } catch (err) {
      const fallback = loadCachedScanFallback();
      if (fallback) {
        setScanData(fallback);
        setSelectedSymbol((prev) => prev ?? fallback.stocks[0]?.symbol ?? null);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Tidak dapat terhubung ke server data IDX. Pastikan koneksi aktif.'
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchMarketScan(false);
  }, [fetchMarketScan]);

  const handleLookupCustomSymbol = async (rawSymbol: string) => {
    setCustomLookupLoading(true);
    setCustomLookupError(null);
    try {
      const res = await fetch(`/api/market/stock?symbol=${encodeURIComponent(rawSymbol)}`);
      const data = await safeParseJson<StockAnalysis & { error?: string }>(res);
      if (!res.ok || !data || !data.symbol) {
        throw new Error(data?.error || `Emiten ${rawSymbol} tidak ditemukan`);
      }
      const stock = data as StockAnalysis;
      setScanData((prev) => {
        if (!prev) {
          return {
            scannedAt: new Date().toISOString(),
            source: 'IDX (.JK)',
            cached: false,
            stale: stock.isStale,
            failoverUsed: stock.dataProvider.includes('Failover'),
            providerNotes: stock.dataProvider,
            ihsg: null,
            stocks: [stock],
            failedSymbols: [],
            summary: {
              totalScanned: 1,
              setupBeliCount: stock.signal === 'SETUP_BELI' ? 1 : 0,
              alertKeluarCount: stock.signal === 'ALERT_KELUAR' ? 1 : 0,
              pantauCount: stock.signal === 'PANTAU' ? 1 : 0,
              araWatchCount: stock.araWatch.isCandidate ? 1 : 0,
              trapBlockedCount: stock.manipulationFlags.length > 0 ? 1 : 0,
            },
          };
        }
        const exists = prev.stocks.some((s) => s.symbol === stock.symbol);
        const nextStocks = exists
          ? prev.stocks.map((s) => (s.symbol === stock.symbol ? stock : s))
          : [stock, ...prev.stocks];
        return {
          ...prev,
          stocks: nextStocks,
          summary: {
            totalScanned: nextStocks.length,
            setupBeliCount: nextStocks.filter((s) => s.signal === 'SETUP_BELI').length,
            alertKeluarCount: nextStocks.filter((s) => s.signal === 'ALERT_KELUAR').length,
            pantauCount: nextStocks.filter((s) => s.signal === 'PANTAU').length,
            araWatchCount: nextStocks.filter((s) => s.araWatch.isCandidate).length,
            trapBlockedCount: nextStocks.filter(
              (s) => s.manipulationRisk === 'TINGGI' || s.manipulationFlags.length > 0
            ).length,
          },
        };
      });
      setSelectedSymbol(stock.symbol);
    } catch (err) {
      setCustomLookupError(
        err instanceof Error ? err.message : `Gagal menganalisis emiten ${rawSymbol}.`
      );
    } finally {
      setCustomLookupLoading(false);
    }
  };

  const selectedStock = useMemo(() => {
    if (!scanData || scanData.stocks.length === 0) return null;
    if (!selectedSymbol) return scanData.stocks[0];
    return scanData.stocks.find((s) => s.symbol === selectedSymbol) ?? scanData.stocks[0];
  }, [scanData, selectedSymbol]);

  const trackedSymbols = useMemo(() => new Set(positions.map((p) => p.symbol)), [positions]);

  const urgentPositionCount = useMemo(() => {
    if (!scanData) return 0;
    const map = new Map(scanData.stocks.map((s) => [s.symbol, s]));
    return positions.filter((p) => {
      const m = map.get(p.symbol);
      if (!m) return false;
      return (
        m.lastClose <= p.cutLoss ||
        m.exitUrgency === 'KRITIS' ||
        m.exitUrgency === 'TINGGI' ||
        m.manipulationRisk === 'TINGGI'
      );
    }).length;
  }, [positions, scanData]);

  const handleAddFromDetail = (stock: StockAnalysis) => {
    setPrefillStock(stock);
    setActiveTab('portfolio');
  };

  const handleAddPosition = (pos: Omit<PortfolioPosition, 'id'>) => {
    const id = `${pos.symbol}-${Date.now()}`;
    setPositions((prev) => [{ ...pos, id }, ...prev]);
  };

  const handleRemovePosition = (id: string) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
  };

  const handleInspectStock = (stock: StockAnalysis) => {
    setSelectedSymbol(stock.symbol);
    setActiveTab('screener');
  };

  const currentTabLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Screener Swing';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar Navigation (256px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:translate-x-0 dark:border-slate-800 dark:bg-slate-900 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-6 dark:border-slate-800">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('screener');
              setMobileNavOpen(false);
            }}
            className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 dark:text-slate-100"
          >
            Pilar IDX
          </a>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Tutup navigasi"
            className="rounded p-1 text-slate-500 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-4" aria-label="Navigasi utama">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileNavOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'alerts' && urgentPositionCount > 0 && (
                  <span className="font-mono text-xs font-semibold tabular-nums text-red-600 dark:text-red-400">
                    {urgentPositionCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setDarkMode((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <span>{darkMode ? 'Tema Terang' : 'Tema Gelap'}</span>
            {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        {/* Top Bar (Contextual Breadcrumb + Single Primary Action) */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-8 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xs sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Buka navigasi"
              className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 truncate text-sm">
              <span className="text-slate-500 whitespace-nowrap dark:text-slate-400">
                Pilar IDX
              </span>
              <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                /
              </span>
              <h1 className="truncate font-semibold text-slate-900 dark:text-slate-100">
                {currentTabLabel}
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={() => fetchMarketScan(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Memindai...' : 'Pindai Pasar'}
          </button>
        </header>

        {/* Main Workspace Canvas */}
        <main className="mx-auto w-full max-w-[1360px] flex-1 p-4 sm:p-6">
          {activeTab === 'screener' && (
            <ScreenerView
              scanData={scanData}
              loading={loading}
              error={error}
              selectedStock={selectedStock}
              onSelectStock={(s) => setSelectedSymbol(s.symbol)}
              onLookupCustomSymbol={handleLookupCustomSymbol}
              customLookupLoading={customLookupLoading}
              customLookupError={customLookupError}
              onAddToPortfolio={handleAddFromDetail}
              trackedSymbols={trackedSymbols}
              onRetry={() => fetchMarketScan(true)}
            />
          )}

          {activeTab === 'alerts' && (
            <ExitAlertView
              stocks={scanData?.stocks ?? []}
              positions={positions}
              onInspectStock={handleInspectStock}
              onGoToPortfolio={() => setActiveTab('portfolio')}
            />
          )}

          {activeTab === 'portfolio' && (
            <PortfolioRiskView
              stocks={scanData?.stocks ?? []}
              positions={positions}
              onAddPosition={handleAddPosition}
              onRemovePosition={handleRemovePosition}
              prefillStock={prefillStock}
            />
          )}

          {activeTab === 'deploy' && <DeployCronView />}
        </main>

        {/* Quiet Legal Disclaimer Footer */}
        <footer className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <div className="mx-auto flex max-w-[1360px] flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Pilar IDX — Analisis teknikal, arus uang, anti-jebakan &amp; sentimen berita BEI (.JK).
              Bukan jaminan keuntungan pasti atau ARA berulang.
            </span>
            <span className="shrink-0">Selalu terapkan Cut Loss dan batas risiko 1–2% per posisi.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
