# Pilar IDX — Swing Screener & Exit Alert

Terminal analisis teknikal untuk swing trading saham likuid di Bursa Efek Indonesia (IHSG / IDX) lengkap dengan perhitungan fraksi harga BEI, manajemen risiko disiplin, deteksi dini sinyal keluar sebelum breakdown, dan integrasi cronjob untuk Vercel.

> **Disclaimer Risiko:** Tidak ada saham yang *pasti naik* di pasar modal. Seluruh sinyal pada aplikasi ini dihasilkan secara objektif dari indikator teknikal historis (EMA 20/50, RSI 14, MACD, ATR 14, rasio volume, dan struktur support/resistance) sebagai alat bantu berbasis probabilitas. Keputusan transaksi dan disiplin Cut Loss sepenuhnya merupakan tanggung jawab trader.

## Arsitektur Proyek

- `shared/` — Mesin analisis teknikal BEI (`idxIndicators.ts`), daftar saham likuid IDX (`idxUniverse.ts`), dan pengambil data pasar serta pengirim notifikasi (`idxFetcher.ts`).
- `api/` — Serverless Functions untuk Vercel (`/api/market/scan`, `/api/market/stock`, `/api/cron/scan`, `/api/config/status`, `/api/alerts/test`).
- `server.ts` — Server Express lokal untuk pengembangan di port `3000`.
- `vercel.json` — Konfigurasi build Vite, rewrite SPA, dan Vercel Cron harian (09:15 WIB Senin–Jumat).
- `.github/workflows/idx-cron-ping.yml` — Workflow GitHub Actions opsional untuk ping otomatis setiap 30 menit selama jam bursa BEI (09:00–16:00 WIB) tanpa batas kuota cron Hobby Vercel.

## Cara Deploy ke GitHub -> Vercel -> Cronjob

1. **Push ke GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Pilar IDX Swing Screener & Exit Alert"
   git branch -M main
   git remote add origin https://github.com/USERNAME/pilar-idx.git
   git push -u origin main
   ```

2. **Import ke Vercel**
   - Buka [vercel.com/new](https://vercel.com/new) dan pilih repository `pilar-idx`.
   - Framework Preset: **Vite** (Build Command: `npm run build`, Output Directory: `dist`).

3. **Tambahkan Environment Variables di Vercel**
   Buka **Project Settings -> Environment Variables**:
   - `CRON_SECRET` — String acak kuat (contoh: `openssl rand -hex 24`) untuk melindungi `/api/cron/scan`.
   - `TELEGRAM_BOT_TOKEN` *(opsional)* — Token bot dari `@BotFather`.
   - `TELEGRAM_CHAT_ID` *(opsional)* — ID chat/channel Telegram tujuan alert.
   - `DISCORD_WEBHOOK_URL` *(opsional)* — URL Webhook Discord.

4. **Aktifkan Cronjob Ping**
   - **Opsi A (Vercel Cron):** Aktif otomatis dari `vercel.json` setiap hari bursa pukul 09:15 WIB (`15 2 * * 1-5` UTC).
   - **Opsi B (GitHub Actions tiap 30 menit):** Di GitHub Repo -> **Settings -> Secrets and variables -> Actions**, tambahkan secret `VERCEL_APP_URL` (contoh: `https://pilar-idx.vercel.app`) dan `CRON_SECRET`.
   - **Opsi C (cron-job.org):** Buat job GET ke `https://DOMAIN-ANDA.vercel.app/api/cron/scan` dengan header `Authorization: Bearer <CRON_SECRET>` pada jadwal `*/15 9-16 * * 1-5` zona waktu `Asia/Jakarta`.
