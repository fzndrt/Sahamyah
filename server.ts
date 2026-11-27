import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dispatchServerNotifications,
  executeCronScan,
  fetchSingleStockAnalysis,
  getNotificationConfigStatus,
  scanIdxMarket,
  verifyCronAuthorization,
} from './shared/idxFetcher.ts';
import { fetchStockSentiment } from './shared/idxSentiment.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'pilar-idx',
      failoverReady: true,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/config/status', (_req, res) => {
    res.json(getNotificationConfigStatus());
  });

  app.get('/api/market/scan', async (req, res) => {
    try {
      const rawSymbols = typeof req.query.symbols === 'string' ? req.query.symbols : '';
      const force = req.query.refresh === '1' || req.query.refresh === 'true';
      const symbols = rawSymbols
        ? rawSymbols
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      const result = await scanIdxMarket({ symbols, forceRefresh: force });
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memindai pasar IDX';
      res.status(502).json({ error: message });
    }
  });

  app.get('/api/market/stock', async (req, res) => {
    try {
      const rawSymbol = typeof req.query.symbol === 'string' ? req.query.symbol : '';
      const force = req.query.refresh === '1' || req.query.refresh === 'true';
      const analysis = await fetchSingleStockAnalysis(rawSymbol, force);
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
      res.json(analysis);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memuat data emiten IDX';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/market/stock/:symbol', async (req, res) => {
    try {
      const force = req.query.refresh === '1' || req.query.refresh === 'true';
      const analysis = await fetchSingleStockAnalysis(req.params.symbol, force);
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
      res.json(analysis);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memuat data emiten IDX';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/market/sentiment', async (req, res) => {
    try {
      const rawSymbol = typeof req.query.symbol === 'string' ? req.query.symbol : '';
      const report = await fetchStockSentiment(rawSymbol);
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      res.json(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memuat sentimen berita';
      res.status(400).json({ error: message });
    }
  });

  const handleCron = async (req: express.Request, res: express.Response) => {
    if (!verifyCronAuthorization(req.headers)) {
      res.status(401).json({
        ok: false,
        error: 'Unauthorized. Sertakan header Authorization: Bearer <CRON_SECRET>.',
      });
      return;
    }

    try {
      const report = await executeCronScan(true);
      res.json(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal menjalankan cron scan IDX';
      res.status(502).json({ ok: false, error: message });
    }
  };

  app.get('/api/cron/scan', handleCron);
  app.post('/api/cron/scan', handleCron);

  app.post('/api/alerts/test', async (req, res) => {
    if (!verifyCronAuthorization(req.headers)) {
      res.status(401).json({
        ok: false,
        error: 'Unauthorized. Sertakan header Authorization: Bearer <CRON_SECRET>.',
      });
      return;
    }

    try {
      const nowWib = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
      const result = await dispatchServerNotifications(
        `PILAR IDX — Uji Koneksi Alert Berhasil\nWaktu: ${nowWib} WIB\nStatus: Server & jalur failover siap mengirim sinyal swing, anti-jebakan, dan peringatan dini keluar.`
      );
      res.json({ ok: result.telegramSent || result.discordSent, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal mengirim uji alert';
      res.status(502).json({ ok: false, error: message });
    }
  });

  // Global safe error guard so unexpected request errors never crash Express
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan internal server';
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pilar IDX server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Pilar IDX server:', err);
  process.exit(1);
});
