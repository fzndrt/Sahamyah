import { executeCronScan, verifyCronAuthorization } from '../../shared/idxFetcher.ts';

interface VercelReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  if (!verifyCronAuthorization(req.headers)) {
    res.status(401).json({
      ok: false,
      error: 'Unauthorized. Sertakan header Authorization: Bearer <CRON_SECRET>.',
    });
    return;
  }

  try {
    const report = await executeCronScan(true);
    res.status(200).json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menjalankan cron scan IDX';
    res.status(502).json({ ok: false, error: message });
  }
}
