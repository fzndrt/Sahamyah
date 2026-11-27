import type {
  AraWatchInfo,
  ExitUrgency,
  ManipulationRisk,
  SentimentReport,
  SignalStatus,
} from '../../shared/idxTypes.ts';

export function formatRp(value: number): string {
  return `Rp ${Math.round(value).toLocaleString('id-ID')}`;
}

export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatSignedPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatCompactIdr(value: number): string {
  if (value >= 1_000_000_000_000) {
    return `Rp ${(value / 1_000_000_000_000).toFixed(2)} T`;
  }
  if (value >= 1_000_000_000) {
    return `Rp ${(value / 1_000_000_000).toFixed(1)} M`;
  }
  if (value >= 1_000_000) {
    return `Rp ${(value / 1_000_000).toFixed(1)} Jt`;
  }
  return formatRp(value);
}

export function formatVolume(shares: number): string {
  const lots = Math.round(shares / 100);
  if (lots >= 1_000_000) {
    return `${(lots / 1_000_000).toFixed(2)} Jt lot`;
  }
  if (lots >= 1_000) {
    return `${(lots / 1_000).toFixed(1)} Rb lot`;
  }
  return `${lots.toLocaleString('id-ID')} lot`;
}

export function formatWibTime(isoString: string): string {
  try {
    return (
      new Date(isoString).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }) + ' WIB'
    );
  } catch {
    return isoString;
  }
}

export function getSignalLabel(signal: SignalStatus): string {
  switch (signal) {
    case 'SETUP_BELI':
      return 'Setup Beli';
    case 'ALERT_KELUAR':
      return 'Alert Keluar';
    case 'PANTAU':
      return 'Pantau';
    case 'HINDARI':
      return 'Hindari';
  }
}

export function getSignalTextClass(signal: SignalStatus): string {
  switch (signal) {
    case 'SETUP_BELI':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'ALERT_KELUAR':
      return 'text-red-700 dark:text-red-400';
    case 'PANTAU':
      return 'text-amber-700 dark:text-amber-400';
    case 'HINDARI':
      return 'text-slate-500 dark:text-slate-400';
  }
}

export function getUrgencyLabel(urgency: ExitUrgency): string {
  switch (urgency) {
    case 'KRITIS':
      return 'Kritis — Segera Evaluasi Keluar';
    case 'TINGGI':
      return 'Tinggi — Risiko Breakdown';
    case 'WASPADA':
      return 'Waspada — Perketat Trailing Stop';
    case 'AMAN':
      return 'Struktur Terjaga';
  }
}

export function getUrgencyTextClass(urgency: ExitUrgency): string {
  switch (urgency) {
    case 'KRITIS':
      return 'text-red-700 dark:text-red-400';
    case 'TINGGI':
      return 'text-red-600 dark:text-red-400';
    case 'WASPADA':
      return 'text-amber-700 dark:text-amber-400';
    case 'AMAN':
      return 'text-emerald-700 dark:text-emerald-400';
  }
}

export function getManipulationRiskLabel(risk: ManipulationRisk): string {
  switch (risk) {
    case 'RENDAH':
      return 'Bersih (Rendah)';
    case 'SEDANG':
      return 'Waspada (Sedang)';
    case 'TINGGI':
      return 'Diblokir (Tinggi)';
  }
}

export function getManipulationRiskClass(risk: ManipulationRisk): string {
  switch (risk) {
    case 'RENDAH':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'SEDANG':
      return 'text-amber-700 dark:text-amber-400';
    case 'TINGGI':
      return 'text-red-700 dark:text-red-400';
  }
}

export function getAraStageLabel(stage: AraWatchInfo['stage']): string {
  switch (stage) {
    case 'DEKAT_ARA':
      return 'Dekat ARA / Locked Buyer';
    case 'BREAKOUT_KUAT':
      return 'Breakout Volume Ekspansif';
    case 'KOMPRESI_VCP':
      return 'Kompresi VCP (Siap Breakout)';
    case 'TIDAK':
      return 'Normal';
  }
}

export function getSentimentLabel(overall: SentimentReport['overall']): string {
  switch (overall) {
    case 'POSITIF':
      return 'Sentimen Positif';
    case 'NEGATIF':
      return 'Sentimen Negatif';
    case 'NETRAL':
      return 'Sentimen Netral';
    case 'TIDAK_TERSEDIA':
      return 'Feed Berita Tidak Tersedia';
  }
}

export function getSentimentTextClass(overall: SentimentReport['overall']): string {
  switch (overall) {
    case 'POSITIF':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'NEGATIF':
      return 'text-red-700 dark:text-red-400';
    case 'NETRAL':
      return 'text-amber-700 dark:text-amber-400';
    case 'TIDAK_TERSEDIA':
      return 'text-slate-500 dark:text-slate-400';
  }
}
