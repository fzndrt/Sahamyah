import { fetchSingleStockAnalysis } from '../../shared/idxFetcher.ts';

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
    const rawSymbol = typeof req.query.symbol === 'string' ? req.query.symbol : '';
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const analysis = await fetchSingleStockAnalysis(rawSymbol, force);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.status(200).json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memuat data emiten IDX';
    res.status(400).json({ error: message });
  }
}
