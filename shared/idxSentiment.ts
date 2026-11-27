import type { NewsArticle, SentimentReport } from './idxTypes.ts';
import { IDX_SYMBOL_MAP, normalizeIdxSymbol } from './idxUniverse.ts';

interface CacheItem {
  report: SentimentReport;
  expiresAt: number;
}

const SENTIMENT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const sentimentCache = new Map<string, CacheItem>();
const lkgSentimentCache = new Map<string, SentimentReport>();

const POSITIVE_KEYWORDS = [
  'laba naik',
  'laba bersih naik',
  'laba melesat',
  'cetak laba',
  'dividen',
  'buyback',
  'ekspansi',
  'akumulasi',
  'net buy',
  'asing borong',
  'rekomendasi beli',
  'rekomendasi buy',
  'target harga naik',
  'kontrak baru',
  'kinerja moncer',
  'kinerja positif',
  'pendapatan naik',
  'pendapatan tumbuh',
  'tumbuh solid',
  'menguat',
  'melonjak',
  'melesat',
  'rebound',
  'bullish',
  'surplus',
  'upgrade',
  'outperform',
  'prospek cerah',
  'tertinggi',
  'ara',
];

const NEGATIVE_KEYWORDS = [
  'rugi bersih',
  'mencatat rugi',
  'laba turun',
  'laba anjlok',
  'laba merosot',
  'pendapatan turun',
  'suspensi',
  'disuspensi',
  'uma',
  'unusual market activity',
  'pailit',
  'pkpu',
  'gugatan',
  'kasus hukum',
  'korupsi',
  'denda',
  'net sell',
  'asing jual',
  'asing kabur',
  'distribusi',
  'anjlok',
  'merosot',
  'terjun bebas',
  'longsor',
  'arb',
  'auto rejection bawah',
  'melemah',
  'koreksi tajam',
  'bearish',
  'downgrade',
  'utang membengkak',
  'gagal bayar',
  'default',
  'phk',
  'investigasi',
  'sanksi',
];

function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeHttpUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

function scoreHeadline(text: string): {
  sentiment: 'POSITIF' | 'NETRAL' | 'NEGATIF';
  matchedKeywords: string[];
  rawScore: number;
} {
  const lower = text.toLowerCase();
  const posMatches = POSITIVE_KEYWORDS.filter((kw) => lower.includes(kw));
  const negMatches = NEGATIVE_KEYWORDS.filter((kw) => lower.includes(kw));

  const rawScore = posMatches.length - negMatches.length;
  if (rawScore > 0) {
    return { sentiment: 'POSITIF', matchedKeywords: posMatches.slice(0, 3), rawScore };
  }
  if (rawScore < 0) {
    return { sentiment: 'NEGATIF', matchedKeywords: negMatches.slice(0, 3), rawScore };
  }
  return {
    sentiment: 'NETRAL',
    matchedKeywords: [...posMatches.slice(0, 1), ...negMatches.slice(0, 1)],
    rawScore: 0,
  };
}

function parseRssItems(xml: string, fallbackSource: string): NewsArticle[] {
  const items: NewsArticle[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
    const block = match[1];
    const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const pubDateMatch = block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i);
    const sourceMatch = block.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);

    const rawTitle = titleMatch ? decodeXmlEntities(titleMatch[1]) : '';
    const link = linkMatch ? sanitizeHttpUrl(decodeXmlEntities(linkMatch[1])) : '';
    if (!rawTitle || !link) continue;

    // Strip trailing " - Source Name" from Google News titles if source tag exists
    const source = sourceMatch ? decodeXmlEntities(sourceMatch[1]) : fallbackSource;
    const cleanTitle =
      source && rawTitle.endsWith(` - ${source}`)
        ? rawTitle.slice(0, -(source.length + 3)).trim()
        : rawTitle;

    let publishedAt = '';
    if (pubDateMatch) {
      const dt = new Date(decodeXmlEntities(pubDateMatch[1]));
      if (!Number.isNaN(dt.getTime())) {
        publishedAt = dt.toISOString();
      }
    }

    const scored = scoreHeadline(cleanTitle);
    items.push({
      title: cleanTitle,
      link,
      publishedAt,
      source,
      sentiment: scored.sentiment,
      matchedKeywords: scored.matchedKeywords,
    });
  }

  return items;
}

async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStockSentiment(rawSymbol: string): Promise<SentimentReport> {
  const symbol = normalizeIdxSymbol(rawSymbol);
  if (!symbol) {
    throw new Error('Kode emiten IDX tidak valid (harus 4 karakter, mis. BBCA).');
  }

  const cached = sentimentCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.report;
  }

  const meta = IDX_SYMBOL_MAP.get(symbol);
  const queryTerm = meta ? `saham ${symbol} OR "${meta.name.replace(' Tbk', '')}"` : `saham ${symbol} BEI`;

  const providers: Array<{ name: string; url: string; fallbackSource: string }> = [
    {
      name: 'Google News ID (Primary)',
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(queryTerm)}&hl=id&gl=ID&ceid=ID:id`,
      fallbackSource: 'Google News ID',
    },
    {
      name: 'Yahoo Finance RSS (Failover)',
      url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}.JK&region=ID&lang=en-US`,
      fallbackSource: 'Yahoo Finance',
    },
  ];

  let articles: NewsArticle[] = [];
  let activeProvider = '';

  for (const p of providers) {
    try {
      const xml = await fetchWithTimeout(p.url, 5500);
      const parsed = parseRssItems(xml, p.fallbackSource);
      if (parsed.length > 0) {
        articles = parsed;
        activeProvider = p.name;
        break;
      }
    } catch {
      // Automatically move to next failover provider
    }
  }

  if (articles.length === 0) {
    const lkg = lkgSentimentCache.get(symbol);
    if (lkg) {
      return {
        ...lkg,
        note: 'Feed berita sementara sibuk — menampilkan cache berita terakhir yang berhasil diambil.',
      };
    }

    return {
      symbol,
      fetchedAt: new Date().toISOString(),
      provider: 'Fallback Aman',
      overall: 'TIDAK_TERSEDIA',
      score: 0,
      positiveCount: 0,
      negativeCount: 0,
      neutralCount: 0,
      articles: [],
      note: 'Feed berita publik sedang tidak mengembalikan artikel terbaru untuk emiten ini.',
    };
  }

  const positiveCount = articles.filter((a) => a.sentiment === 'POSITIF').length;
  const negativeCount = articles.filter((a) => a.sentiment === 'NEGATIF').length;
  const neutralCount = articles.length - positiveCount - negativeCount;

  const net = positiveCount - negativeCount;
  const score = Math.round((net / Math.max(1, articles.length)) * 100);
  const overall: SentimentReport['overall'] =
    score >= 18 ? 'POSITIF' : score <= -18 ? 'NEGATIF' : 'NETRAL';

  const report: SentimentReport = {
    symbol,
    fetchedAt: new Date().toISOString(),
    provider: activeProvider,
    overall,
    score,
    positiveCount,
    negativeCount,
    neutralCount,
    articles,
  };

  sentimentCache.set(symbol, { report, expiresAt: Date.now() + SENTIMENT_TTL_MS });
  lkgSentimentCache.set(symbol, report);
  return report;
}
