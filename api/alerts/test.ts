import { dispatchServerNotifications, verifyCronAuthorization } from '../../shared/idxFetcher.ts';

interface VercelReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'POST') {
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

  const nowWib = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const result = await dispatchServerNotifications(
    `PILAR IDX — Uji Koneksi Alert Berhasil\nWaktu: ${nowWib} WIB\nStatus: Server siap mengirim sinyal swing & peringatan dini keluar.`
  );
  res.status(200).json({ ok: result.telegramSent || result.discordSent, ...result });
}
