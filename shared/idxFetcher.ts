import crypto from 'node:crypto';
import { analyzeIndex, analyzeStock, type RawOhlcv } from './idxIndicators.ts';
import type {
  CronScanReport,
  IndexSummary,
  MarketScanResponse,
  StockAnalysis,
} from './idxTypes.ts';
import { IDX_SYMBOL_MAP, IDX_UNIVERSE, normalizeIdxSymbol } from './idxUniverse.ts';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface OhlcvFetchResult {
  candles: RawOhlcv[];
  provider: string;
  failoverUsed: boolean;
  isStale: boolean;
}

const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes active TTL
const scanCache = new Map<string, CacheEntry<MarketScanResponse>>();
const stockCache = new Map<string, CacheEntry<StockAnalysis>>();

// Last-Known-Good (LKG) safety caches — survive upstream outages without crashing
const lkgOhlcvCache = new Map<string, { candles: RawOhlcv[]; savedAt: string }>();
const lkgScanCache = new Map<string, MarketScanResponse>();

const YAHOO_ALLOWED_TICKER_RE = /^(\^JKSE|[A-Z0-9]{4}\.JK)$/;

function formatIsoDateFromUnix(sec: number): string {
  // IDX timezone is WIB (UTC+7)
  const d = new Date((sec + 7 * 3600) * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function fetchYahooChartFromHost(
  host: 'query1.finance.yahoo.com' | 'query2.finance.yahoo.com',
  yahooTicker: string,
  range: '6mo' | '3mo',
  timeoutMs = 7000
): Promise<RawOhlcv[]> {
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(
    yahooTicker
  )}?range=${range}&interval=1d&includePrePost=false`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const payload = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }>;
        error?: { description?: string } | null;
      };
    };

    const result = payload.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      throw new Error(payload.chart?.error?.description || 'Data historis kosong');
    }

    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];
    const candles: RawOhlcv[] = [];
    const seenDates = new Set<string>();

    for (let i = 0; i < timestamps.length; i++) {
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      const volume = quote.volume?.[i] ?? 0;

      if (
        typeof open !== 'number' ||
        typeof high !== 'number' ||
        typeof low !== 'number' ||
        typeof close !== 'number' ||
        !Number.isFinite(close) ||
        close <= 0
      ) {
        continue;
      }

      const date = formatIsoDateFromUnix(timestamps[i]);
      const cleanVol = typeof volume === 'number' && Number.isFinite(volume) ? volume : 0;

      if (seenDates.has(date)) {
        candles[candles.length - 1] = {
          date,
          timestamp: timestamps[i],
          open,
          high,
          low,
          close,
          volume: cleanVol,
        };
      } else {
        seenDates.add(date);
        candles.push({
          date,
          timestamp: timestamps[i],
          open,
          high,
          low,
          close,
          volume: cleanVol,
        });
      }
    }

    if (candles.length < 2) {
      throw new Error('Jumlah candle historis tidak mencukupi');
    }

    return candles;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Multi-tier resilient market data fetcher:
 * Tier 1: Yahoo Finance Primary (query1, 6mo)
 * Tier 2: Yahoo Finance Failover Cluster (query2, 6mo)
 * Tier 3: Yahoo Finance Lightweight Range Failover (query2, 3mo)
 * Tier 4: Last-Known-Good (LKG) Stale Cache agar aplikasi tidak pernah crash saat URL bermasalah
 */
export async function fetchResilientOhlcv(yahooTicker: string): Promise<OhlcvFetchResult> {
  if (!YAHOO_ALLOWED_TICKER_RE.test(yahooTicker)) {
    throw new Error('Format kode saham IDX tidak valid');
  }

  const attempts: Array<{
    label: string;
    host: 'query1.finance.yahoo.com' | 'query2.finance.yahoo.com';
    range: '6mo' | '3mo';
    failover: boolean;
    timeoutMs: number;
  }> = [
    {
      label: 'Yahoo Finance Q1',
      host: 'query1.finance.yahoo.com',
      range: '6mo',
      failover: false,
      timeoutMs: 6500,
    },
    {
      label: 'Yahoo Finance Q2 (Failover)',
      host: 'query2.finance.yahoo.com',
      range: '6mo',
      failover: true,
      timeoutMs: 7000,
    },
    {
      label: 'Yahoo Finance Q2-3M (Failover)',
      host: 'query2.finance.yahoo.com',
      range: '3mo',
      failover: true,
      timeoutMs: 7000,
    },
  ];

  let lastErr: unknown = null;

  for (const step of attempts) {
    try {
      const candles = await fetchYahooChartFromHost(
        step.host,
        yahooTicker,
        step.range,
        step.timeoutMs
      );
      lkgOhlcvCache.set(yahooTicker, {
        candles,
        savedAt: new Date().toISOString(),
      });
      return {
        candles,
        provider: step.label,
        failoverUsed: step.failover,
        isStale: false,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  // Tier 4: Fallback to Last-Known-Good cache instead of crashing
  const lkg = lkgOhlcvCache.get(yahooTicker);
  if (lkg && lkg.candles.length >= 2) {
    return {
      candles: lkg.candles,
      provider: `Cache Terakhir (${lkg.savedAt.slice(0, 10)})`,
      failoverUsed: true,
      isStale: true,
    };
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Seluruh jalur data untuk ${yahooTicker} gagal dihubungi`);
}

async function runInBatches<T, R>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const settled = await Promise.allSettled(chunk.map((item) => worker(item)));
    results.push(...settled);
  }
  return results;
}

export async function fetchSingleStockAnalysis(
  rawSymbol: string,
  forceRefresh = false,
  ihsgReturn20dPct?: number | null
): Promise<StockAnalysis> {
  const symbol = normalizeIdxSymbol(rawSymbol);
  if (!symbol) {
    throw new Error('Kode saham harus 4 huruf/angka IDX (contoh: BBCA, BBRI, ANTM).');
  }

  const cached = stockCache.get(symbol);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const meta = IDX_SYMBOL_MAP.get(symbol) ?? {
    symbol,
    yahooTicker: `${symbol}.JK`,
    name: `Emiten ${symbol} Tbk`,
    sector: 'Bursa Efek Indonesia',
  };

  let ihsgRet = ihsgReturn20dPct;
  if (ihsgRet === undefined) {
    try {
      const ihsgRes = await fetchResilientOhlcv('^JKSE');
      ihsgRet = analyzeIndex(ihsgRes.candles, 'IHSG', 'Indeks Harga Saham Gabungan')?.return20dPct ?? null;
    } catch {
      ihsgRet = null;
    }
  }

  const fetched = await fetchResilientOhlcv(meta.yahooTicker);
  const analysis = analyzeStock(meta.symbol, meta.yahooTicker, meta.name, meta.sector, fetched.candles, {
    ihsgReturn20dPct: ihsgRet,
    dataProvider: fetched.provider,
    isStale: fetched.isStale,
  });

  if (!analysis) {
    throw new Error(`Data candle historis ${symbol} belum cukup untuk analisis teknikal.`);
  }

  stockCache.set(symbol, { data: analysis, expiresAt: Date.now() + CACHE_TTL_MS });
  return analysis;
}

export async function scanIdxMarket(options?: {
  symbols?: string[];
  forceRefresh?: boolean;
}): Promise<MarketScanResponse> {
  const requestedSymbols = options?.symbols?.length
    ? Array.from(
        new Set(
          options.symbols
            .map((s) => normalizeIdxSymbol(s))
            .filter((s): s is string => s !== null)
        )
      ).slice(0, 40)
    : IDX_UNIVERSE.map((s) => s.symbol);

  const cacheKey = requestedSymbols.join(',');
  const existing = scanCache.get(cacheKey);
  if (!options?.forceRefresh && existing && existing.expiresAt > Date.now()) {
    return { ...existing.data, cached: true };
  }

  let ihsg: IndexSummary | null = null;
  let failoverUsed = false;
  let anyStale = false;

  // Fetch IHSG first so Relative Strength vs IHSG is calculated accurately for all stocks
  try {
    const ihsgFetched = await fetchResilientOhlcv('^JKSE');
    if (ihsgFetched.failoverUsed) failoverUsed = true;
    if (ihsgFetched.isStale) anyStale = true;
    ihsg = analyzeIndex(ihsgFetched.candles, 'IHSG', 'Indeks Harga Saham Gabungan');
  } catch {
    ihsg = null;
  }

  const settled = await runInBatches(requestedSymbols, 6, async (symbol) => {
    return await fetchSingleStockAnalysis(
      symbol,
      options?.forceRefresh,
      ihsg?.return20dPct ?? null
    );
  });

  const stocks: StockAnalysis[] = [];
  const failedSymbols: string[] = [];

  settled.forEach((res, idx) => {
    if (res.status === 'fulfilled') {
      stocks.push(res.value);
      if (res.value.dataProvider.includes('Failover')) failoverUsed = true;
      if (res.value.isStale) anyStale = true;
    } else {
      failedSymbols.push(requestedSymbols[idx]);
    }
  });

  // If ALL upstream calls failed completely, serve Last-Known-Good full scan instead of crashing
  if (stocks.length === 0) {
    const lkgScan = lkgScanCache.get(cacheKey);
    if (lkgScan) {
      return {
        ...lkgScan,
        cached: true,
        stale: true,
        failoverUsed: true,
        providerNotes:
          'Sumber data utama & cadangan sedang mengalami gangguan. Menampilkan snapshot pasar terakhir yang valid.',
      };
    }
  }

  const priorityMap = {
    SETUP_BELI: 0,
    ALERT_KELUAR: 1,
    PANTAU: 2,
    HINDARI: 3,
  } as const;

  const urgencyScore = {
    KRITIS: 3,
    TINGGI: 2,
    WASPADA: 1,
    AMAN: 0,
  } as const;

  stocks.sort((a, b) => {
    const pDiff = priorityMap[a.signal] - priorityMap[b.signal];
    if (pDiff !== 0) return pDiff;
    if (a.signal === 'SETUP_BELI') {
      if (b.confluencePassed !== a.confluencePassed) {
        return b.confluencePassed - a.confluencePassed;
      }
      return b.indicators.cmf20 - a.indicators.cmf20;
    }
    if (a.signal === 'ALERT_KELUAR') {
      return urgencyScore[b.exitUrgency] - urgencyScore[a.exitUrgency];
    }
    return b.confluencePassed - a.confluencePassed;
  });

  const providerNotes = anyStale
    ? 'Sebagian data diambil dari cache terakhir karena jalur upstream sementara melambat.'
    : failoverUsed
      ? 'Jalur cadangan (Yahoo Finance Q2 Failover) aktif otomatis tanpa gangguan.'
      : 'Data langsung dari jalur utama (Yahoo Finance Q1) dengan cadangan failover Q2 siap aktif.';

  const response: MarketScanResponse = {
    scannedAt: new Date().toISOString(),
    source: failoverUsed ? 'IDX (.JK) — Jalur Failover Aktif' : 'IDX (.JK) — Jalur Utama',
    cached: false,
    stale: anyStale,
    failoverUsed,
    providerNotes,
    ihsg,
    stocks,
    failedSymbols,
    summary: {
      totalScanned: stocks.length,
      setupBeliCount: stocks.filter((s) => s.signal === 'SETUP_BELI').length,
      alertKeluarCount: stocks.filter((s) => s.signal === 'ALERT_KELUAR').length,
      pantauCount: stocks.filter((s) => s.signal === 'PANTAU').length,
      araWatchCount: stocks.filter((s) => s.araWatch.isCandidate).length,
      trapBlockedCount: stocks.filter(
        (s) => s.manipulationRisk === 'TINGGI' || s.manipulationFlags.length > 0
      ).length,
    },
  };

  if (stocks.length > 0) {
    scanCache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
    lkgScanCache.set(cacheKey, response);
  }

  return response;
}

export function verifyCronAuthorization(headers: Record<string, string | string[] | undefined>): boolean {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret) {
    return true;
  }

  const rawAuth = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;
  const rawCustom = Array.isArray(headers['x-cron-secret'])
    ? headers['x-cron-secret'][0]
    : headers['x-cron-secret'];

  const bearerToken = rawAuth?.startsWith('Bearer ') ? rawAuth.slice(7).trim() : '';
  const candidate = bearerToken || rawCustom?.trim() || '';

  if (!candidate) return false;

  const expectedBuf = Buffer.from(configuredSecret, 'utf8');
  const candidateBuf = Buffer.from(candidate, 'utf8');
  if (expectedBuf.length !== candidateBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, candidateBuf);
}

export function getNotificationConfigStatus() {
  return {
    cronSecretConfigured: Boolean(process.env.CRON_SECRET?.trim()),
    telegramConfigured: Boolean(
      process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim()
    ),
    discordConfigured: Boolean(process.env.DISCORD_WEBHOOK_URL?.trim()),
  };
}

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString('id-ID')}`;
}

export function buildAlertMessage(report: Omit<CronScanReport, 'notifications'>): string {
  const lines: string[] = [];
  lines.push(`PILAR IDX — Laporan Swing, Anti-Jebakan & Exit Alert`);
  lines.push(
    `Waktu: ${new Date(report.executedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`
  );

  if (report.ihsg) {
    const sign = report.ihsg.changePct >= 0 ? '+' : '';
    lines.push(
      `IHSG: ${report.ihsg.lastClose.toLocaleString('id-ID')} (${sign}${report.ihsg.changePct.toFixed(2)}%) · Tren ${report.ihsg.regime}`
    );
  }

  lines.push('');
  if (report.exitAlerts.length > 0) {
    lines.push(`PERINGATAN KELUAR / JEBAKAN (${report.exitAlerts.length}):`);
    report.exitAlerts.slice(0, 6).forEach((item) => {
      lines.push(
        `- ${item.symbol} (${formatRupiah(item.lastClose)}, ${item.changePct.toFixed(2)}%) [${item.exitUrgency}]: ${item.reasons[0] || 'Breakdown teknikal'}`
      );
    });
  } else {
    lines.push('PERINGATAN KELUAR: Tidak ada breakdown kritis terdeteksi.');
  }

  lines.push('');
  if (report.buySetups.length > 0) {
    lines.push(`SETUP SWING LOLOS ANTI-JEBAKAN (${report.buySetups.length}):`);
    report.buySetups.slice(0, 6).forEach((item) => {
      lines.push(
        `- ${item.symbol} (${formatRupiah(item.lastClose)}) · CMF ${item.cmf20 >= 0 ? '+' : ''}${item.cmf20.toFixed(2)} | Entry ${formatRupiah(item.entryMin)}-${formatRupiah(item.entryMax)} | CL ${formatRupiah(item.cutLoss)} | TP1 ${formatRupiah(item.tp1)} (R:R 1:${item.riskRewardRatio})`
      );
    });
  } else {
    lines.push('SETUP SWING: Belum ada emiten lolos seluruh filter disiplin hari ini.');
  }

  if (report.araWatchCandidates.length > 0) {
    lines.push('');
    lines.push(`RADAR MOMENTUM KUAT / ARA WATCH (${report.araWatchCandidates.length}):`);
    report.araWatchCandidates.slice(0, 4).forEach((item) => {
      lines.push(
        `- ${item.symbol} (${formatRupiah(item.lastClose)}, ${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(1)}%) [${item.stage}] — Est. ARA ${formatRupiah(item.araPriceEstimate)}`
      );
    });
  }

  lines.push('');
  lines.push(
    'Disclaimer: Analisis probabilitas teknikal & arus uang. Tidak ada jaminan pasti naik/ARA; wajib disiplin Cut Loss.'
  );
  return lines.join('\n');
}

export async function dispatchServerNotifications(text: string): Promise<{
  telegramSent: boolean;
  discordSent: boolean;
  message?: string;
}> {
  let telegramSent = false;
  let discordSent = false;
  const notes: string[] = [];

  const tgToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const tgChatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (tgToken && tgChatId) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const tgRes = await fetch(
          `https://api.telegram.org/bot${encodeURIComponent(tgToken)}/sendMessage`,
          {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: tgChatId,
              text,
              disable_web_page_preview: true,
            }),
          }
        );
        telegramSent = tgRes.ok;
        if (!tgRes.ok) notes.push(`Telegram HTTP ${tgRes.status}`);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      notes.push('Telegram gagal dihubungi');
    }
  }

  const discordUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (discordUrl && discordUrl.startsWith('https://discord.com/api/webhooks/')) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const dcRes = await fetch(discordUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: text.slice(0, 1950),
          }),
        });
        discordSent = dcRes.ok;
        if (!dcRes.ok) notes.push(`Discord HTTP ${dcRes.status}`);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      notes.push('Discord gagal dihubungi');
    }
  }

  if (!tgToken && !discordUrl) {
    notes.push('Webhook Telegram/Discord belum dikonfigurasi di Environment Variables.');
  }

  return {
    telegramSent,
    discordSent,
    message: notes.length > 0 ? notes.join(' | ') : 'Notifikasi terkirim.',
  };
}

export async function executeCronScan(forceRefresh = true): Promise<CronScanReport> {
  const scan = await scanIdxMarket({ forceRefresh });

  const buySetups = scan.stocks
    .filter((s) => s.signal === 'SETUP_BELI')
    .map((s) => ({
      symbol: s.symbol,
      lastClose: s.lastClose,
      changePct: s.changePct,
      setupLabel: s.setupLabel,
      entryMin: s.tradePlan.entryMin,
      entryMax: s.tradePlan.entryMax,
      cutLoss: s.tradePlan.cutLoss,
      tp1: s.tradePlan.tp1,
      tp2: s.tradePlan.tp2,
      riskRewardRatio: s.tradePlan.riskRewardRatio,
      confluence: `${s.confluencePassed}/${s.confluenceTotal}`,
      cmf20: s.indicators.cmf20,
      manipulationRisk: s.manipulationRisk,
    }));

  const araWatchCandidates = scan.stocks
    .filter((s) => s.araWatch.isCandidate)
    .map((s) => ({
      symbol: s.symbol,
      lastClose: s.lastClose,
      changePct: s.changePct,
      stage: s.araWatch.stage,
      headline: s.araWatch.headline,
      araPriceEstimate: s.araWatch.araPriceEstimate,
    }));

  const exitAlerts = scan.stocks
    .filter(
      (s) =>
        s.signal === 'ALERT_KELUAR' ||
        s.exitUrgency === 'KRITIS' ||
        s.exitUrgency === 'TINGGI' ||
        s.manipulationRisk === 'TINGGI'
    )
    .map((s) => ({
      symbol: s.symbol,
      lastClose: s.lastClose,
      changePct: s.changePct,
      exitUrgency: s.exitUrgency,
      manipulationRisk: s.manipulationRisk,
      reasons: [
        ...s.exitWarnings.map((w) => w.title),
        ...s.manipulationFlags.slice(0, 1),
      ],
    }));

  const baseReport = {
    ok: scan.stocks.length > 0,
    executedAt: scan.scannedAt,
    stale: scan.stale,
    failoverUsed: scan.failoverUsed,
    ihsg: scan.ihsg,
    buySetups,
    araWatchCandidates,
    exitAlerts,
  };

  const text = buildAlertMessage(baseReport);
  const notifications = await dispatchServerNotifications(text);

  return {
    ...baseReport,
    notifications,
  };
}
