import { scanIdxMarket } from '../../shared/idxFetcher.ts';

interface VercelReq {
  method?: string;
  query: Record<string, string | string[] | undefined>;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  setHeader: (name: string, value: string) => void;
  json: (body: unknown) => void;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

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
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memindai pasar IDX';
    res.status(502).json({ error: message });
  }
}
