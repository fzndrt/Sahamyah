import { fetchStockSentiment } from '../../shared/idxSentiment.ts';

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
    const report = await fetchStockSentiment(rawSymbol);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memuat sentimen berita emiten';
    res.status(400).json({ error: message });
  }
}
