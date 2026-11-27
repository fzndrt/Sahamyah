import { Check, Copy, Play, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CronScanReport } from '../../shared/idxTypes.ts';
import { formatWibTime } from '../lib/formatters.ts';

interface ConfigStatus {
  cronSecretConfigured: boolean;
  telegramConfigured: boolean;
  discordConfigured: boolean;
}

const VERCEL_JSON_SNIPPET = `{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "crons": [
    {
      "path": "/api/cron/scan",
      "schedule": "15 2 * * 1-5"
    }
  ]
}`;

const GITHUB_WORKFLOW_SNIPPET = `name: Pilar IDX Cron Ping (Jam Bursa BEI)
on:
  schedule:
    - cron: '*/30 2-9 * * 1-5' # 09:00-16:00 WIB (Senin-Jumat)
  workflow_dispatch:

jobs:
  ping-vercel-cron:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl --fail --silent --show-error \\
            -H "Authorization: Bearer \${{ secrets.CRON_SECRET }}" \\
            "\${{ secrets.VERCEL_APP_URL }}/api/cron/scan"`;

export function DeployCronView() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [bearerToken, setBearerToken] = useState('');
  const [runningCron, setRunningCron] = useState(false);
  const [cronResult, setCronResult] = useState<CronScanReport | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);
  const [testNotice, setTestNotice] = useState<string | null>(null);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStatus(data))
      .catch(() => setStatus(null));
  }, []);

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard API unavailable
    }
  };

  const runLiveCronPing = async () => {
    setRunningCron(true);
    setCronError(null);
    setCronResult(null);
    try {
      const headers: Record<string, string> = {};
      if (bearerToken.trim()) {
        headers.Authorization = `Bearer ${bearerToken.trim()}`;
      }
      const res = await fetch('/api/cron/scan', { headers });
      const rawText = await res.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data) {
        setCronError(
          (typeof data?.error === 'string' && data.error) || `Gagal memanggil endpoint (HTTP ${res.status})`
        );
      } else {
        setCronResult(data as unknown as CronScanReport);
      }
    } catch (err) {
      setCronError(err instanceof Error ? err.message : 'Gagal menghubungi /api/cron/scan');
    } finally {
      setRunningCron(false);
    }
  };

  const sendTestAlert = async () => {
    setTestingWebhook(true);
    setTestNotice(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (bearerToken.trim()) {
        headers.Authorization = `Bearer ${bearerToken.trim()}`;
      }
      const res = await fetch('/api/alerts/test', { method: 'POST', headers });
      const rawText = await res.text();
      let data: { ok?: boolean; error?: string; message?: string } | null = null;
      try {
        data = rawText ? (JSON.parse(rawText) as { ok?: boolean; error?: string; message?: string }) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data) {
        setTestNotice(data?.error || `HTTP ${res.status}`);
      } else {
        setTestNotice(
          data.ok
            ? 'Pesan uji berhasil dikirim ke Telegram/Discord.'
            : data.message || 'Belum ada channel webhook yang aktif di server.'
        );
      }
    } catch {
      setTestNotice('Gagal menghubungi endpoint uji alert.');
    } finally {
      setTestingWebhook(false);
    }
  };

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://pilar-idx.vercel.app';
  const curlSnippet = `curl -sS -H "Authorization: Bearer <CRON_SECRET>" "${origin}/api/cron/scan"`;

  return (
    <div className="space-y-6">
      {/* Live Server Endpoint & Cron Simulator */}
      <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Uji Langsung Endpoint Cronjob (/api/cron/scan)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Endpoint ini siap dipanggil oleh Vercel Cron, GitHub Actions, atau cron-job.org untuk
            memindai 28 emiten IDX dan mengirim alert Telegram/Discord secara otomatis.
          </p>
        </div>

        <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
          {/* Status & Trigger */}
          <div className="space-y-4 p-6 lg:col-span-5">
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                <span className="text-slate-600 dark:text-slate-400">CRON_SECRET (Server Env)</span>
                <span
                  className={
                    status?.cronSecretConfigured
                      ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }
                >
                  {status?.cronSecretConfigured ? 'Aktif (Terlindungi)' : 'Belum diset'}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                <span className="text-slate-600 dark:text-slate-400">Telegram Bot Alert</span>
                <span
                  className={
                    status?.telegramConfigured
                      ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }
                >
                  {status?.telegramConfigured ? 'Terkonfigurasi' : 'Opsional (Belum diset)'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Discord Webhook Alert</span>
                <span
                  className={
                    status?.discordConfigured
                      ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }
                >
                  {status?.discordConfigured ? 'Terkonfigurasi' : 'Opsional (Belum diset)'}
                </span>
              </div>
            </div>

            {status?.cronSecretConfigured && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Bearer Token (CRON_SECRET)
                </label>
                <input
                  type="password"
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                  placeholder="Masukkan CRON_SECRET untuk uji manual"
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2.5 pt-1">
              <button
                type="button"
                onClick={runLiveCronPing}
                disabled={runningCron}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                <Play className="h-3.5 w-3.5" />
                {runningCron ? 'Memindai...' : 'Jalankan Ping Cron'}
              </button>

              <button
                type="button"
                onClick={sendTestAlert}
                disabled={testingWebhook}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <Send className="h-3.5 w-3.5" />
                {testingWebhook ? 'Mengirim...' : 'Uji Webhook'}
              </button>
            </div>

            {testNotice && (
              <p className="text-xs text-slate-600 dark:text-slate-300">{testNotice}</p>
            )}
            {cronError && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">{cronError}</p>
            )}
          </div>

          {/* Cron Output Viewer */}
          <div className="p-6 lg:col-span-7">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Respons JSON /api/cron/scan
              </h3>
              {cronResult && (
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {formatWibTime(cronResult.executedAt)}
                </span>
              )}
            </div>

            <pre className="mt-3 max-h-[260px] overflow-auto border border-slate-200 bg-slate-50 p-3.5 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              {cronResult
                ? JSON.stringify(cronResult, null, 2)
                : '// Klik "Jalankan Ping Cron" untuk melihat output real-time JSON\n// yang diterima oleh Vercel Cron / cron-job.org.'}
            </pre>
          </div>
        </div>
      </section>

      {/* Step-by-Step GitHub -> Vercel -> Cronjob Guide */}
      <section className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Panduan Push GitHub, Deploy Vercel &amp; Penjadwalan Cronjob
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Seluruh file serverless (`api/*.ts`), `vercel.json`, dan workflow GitHub Actions sudah
            tersedia langsung di repository ini.
          </p>
        </div>

        <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
          {/* Left: Deployment Steps & cURL */}
          <div className="space-y-5 p-6">
            <ol className="space-y-4 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              <li>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  01. Push kode ke GitHub:
                </span>{' '}
                Buat repository baru di GitHub, lalu jalankan{' '}
                <code className="font-mono text-slate-900 dark:text-slate-100">
                  git push -u origin main
                </code>
                .
              </li>
              <li>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  02. Import di Vercel:
                </span>{' '}
                Pilih repository Anda di Vercel. Build command otomatis terdeteksi{' '}
                <code className="font-mono text-slate-900 dark:text-slate-100">npm run build</code>{' '}
                dengan output{' '}
                <code className="font-mono text-slate-900 dark:text-slate-100">dist</code> dan
                fungsi serverless di folder{' '}
                <code className="font-mono text-slate-900 dark:text-slate-100">api/</code>.
              </li>
              <li>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  03. Konfigurasi Environment Variables Vercel:
                </span>{' '}
                Isi <code className="font-mono">CRON_SECRET</code> (token rahasia acak), serta
                opsional <code className="font-mono">TELEGRAM_BOT_TOKEN</code> &amp;{' '}
                <code className="font-mono">TELEGRAM_CHAT_ID</code> atau{' '}
                <code className="font-mono">DISCORD_WEBHOOK_URL</code>.
              </li>
              <li>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  04. Aktivasi Ping Cronjob Jam Bursa BEI:
                </span>{' '}
                Gunakan Vercel Cron bawaan di <code className="font-mono">vercel.json</code>{' '}
                (09:15 WIB), atau aktifkan workflow GitHub Actions{' '}
                <code className="font-mono">.github/workflows/idx-cron-ping.yml</code> untuk ping
                setiap 30 menit (09:00–16:00 WIB Senin–Jumat), atau pakai layanan gratis{' '}
                <code className="font-mono">cron-job.org</code>.
              </li>
            </ol>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Perintah Ping cURL / cron-job.org
                </span>
                <button
                  type="button"
                  onClick={() => copyText('curl', curlSnippet)}
                  className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  {copiedId === 'curl' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedId === 'curl' ? 'Tersalin' : 'Salin'}
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                {curlSnippet}
              </pre>
            </div>
          </div>

          {/* Right: Config Snippets */}
          <div className="space-y-5 p-6">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  vercel.json (Sudah termasuk di repo)
                </span>
                <button
                  type="button"
                  onClick={() => copyText('vercel', VERCEL_JSON_SNIPPET)}
                  className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  {copiedId === 'vercel' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedId === 'vercel' ? 'Tersalin' : 'Salin'}
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                {VERCEL_JSON_SNIPPET}
              </pre>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  .github/workflows/idx-cron-ping.yml (Tiap 30 Menit)
                </span>
                <button
                  type="button"
                  onClick={() => copyText('gh', GITHUB_WORKFLOW_SNIPPET)}
                  className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  {copiedId === 'gh' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedId === 'gh' ? 'Tersalin' : 'Salin'}
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                {GITHUB_WORKFLOW_SNIPPET}
              </pre>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
