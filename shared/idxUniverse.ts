export interface IdxStockMeta {
  symbol: string;
  yahooTicker: string;
  name: string;
  sector: string;
}

export const IDX_UNIVERSE: IdxStockMeta[] = [
  { symbol: 'BBCA', yahooTicker: 'BBCA.JK', name: 'Bank Central Asia Tbk', sector: 'Perbankan' },
  { symbol: 'BBRI', yahooTicker: 'BBRI.JK', name: 'Bank Rakyat Indonesia Tbk', sector: 'Perbankan' },
  { symbol: 'BMRI', yahooTicker: 'BMRI.JK', name: 'Bank Mandiri Tbk', sector: 'Perbankan' },
  { symbol: 'BBNI', yahooTicker: 'BBNI.JK', name: 'Bank Negara Indonesia Tbk', sector: 'Perbankan' },
  { symbol: 'BRIS', yahooTicker: 'BRIS.JK', name: 'Bank Syariah Indonesia Tbk', sector: 'Perbankan' },
  { symbol: 'TLKM', yahooTicker: 'TLKM.JK', name: 'Telkom Indonesia Tbk', sector: 'Telekomunikasi' },
  { symbol: 'EXCL', yahooTicker: 'EXCL.JK', name: 'XL Axiata Tbk', sector: 'Telekomunikasi' },
  { symbol: 'ISAT', yahooTicker: 'ISAT.JK', name: 'Indosat Tbk', sector: 'Telekomunikasi' },
  { symbol: 'ASII', yahooTicker: 'ASII.JK', name: 'Astra International Tbk', sector: 'Otomotif & Industri' },
  { symbol: 'UNTR', yahooTicker: 'UNTR.JK', name: 'United Tractors Tbk', sector: 'Energi & Tambang' },
  { symbol: 'ADRO', yahooTicker: 'ADRO.JK', name: 'Alamtri Resources Indonesia Tbk', sector: 'Energi & Tambang' },
  { symbol: 'PTBA', yahooTicker: 'PTBA.JK', name: 'Bukit Asam Tbk', sector: 'Energi & Tambang' },
  { symbol: 'ITMG', yahooTicker: 'ITMG.JK', name: 'Indo Tambangraya Megah Tbk', sector: 'Energi & Tambang' },
  { symbol: 'PGAS', yahooTicker: 'PGAS.JK', name: 'Perusahaan Gas Negara Tbk', sector: 'Energi & Tambang' },
  { symbol: 'MEDC', yahooTicker: 'MEDC.JK', name: 'Medco Energi Internasional Tbk', sector: 'Energi & Tambang' },
  { symbol: 'BUMI', yahooTicker: 'BUMI.JK', name: 'Bumi Resources Tbk', sector: 'Energi & Tambang' },
  { symbol: 'ENRG', yahooTicker: 'ENRG.JK', name: 'Energi Mega Persada Tbk', sector: 'Energi & Tambang' },
  { symbol: 'ANTM', yahooTicker: 'ANTM.JK', name: 'Aneka Tambang Tbk', sector: 'Mineral & Logam' },
  { symbol: 'INCO', yahooTicker: 'INCO.JK', name: 'Vale Indonesia Tbk', sector: 'Mineral & Logam' },
  { symbol: 'MDKA', yahooTicker: 'MDKA.JK', name: 'Merdeka Copper Gold Tbk', sector: 'Mineral & Logam' },
  { symbol: 'BRPT', yahooTicker: 'BRPT.JK', name: 'Barito Pacific Tbk', sector: 'Petrokimia & Energi' },
  { symbol: 'TPIA', yahooTicker: 'TPIA.JK', name: 'Chandra Asri Pacific Tbk', sector: 'Petrokimia & Energi' },
  { symbol: 'BREN', yahooTicker: 'BREN.JK', name: 'Barito Renewables Energy Tbk', sector: 'Energi Terbarukan' },
  { symbol: 'PGEO', yahooTicker: 'PGEO.JK', name: 'Pertamina Geothermal Energy Tbk', sector: 'Energi Terbarukan' },
  { symbol: 'ICBP', yahooTicker: 'ICBP.JK', name: 'Indofood CBP Sukses Makmur Tbk', sector: 'Konsumer' },
  { symbol: 'INDF', yahooTicker: 'INDF.JK', name: 'Indofood Sukses Makmur Tbk', sector: 'Konsumer' },
  { symbol: 'MYOR', yahooTicker: 'MYOR.JK', name: 'Mayora Indah Tbk', sector: 'Konsumer' },
  { symbol: 'AMRT', yahooTicker: 'AMRT.JK', name: 'Sumber Alfaria Trijaya Tbk', sector: 'Ritel' },
  { symbol: 'KLBF', yahooTicker: 'KLBF.JK', name: 'Kalbe Farma Tbk', sector: 'Kesehatan' },
  { symbol: 'MIKA', yahooTicker: 'MIKA.JK', name: 'Mitra Keluarga Karyasehat Tbk', sector: 'Kesehatan' },
  { symbol: 'CPIN', yahooTicker: 'CPIN.JK', name: 'Charoen Pokphand Indonesia Tbk', sector: 'Agribisnis & Pakan' },
  { symbol: 'AKRA', yahooTicker: 'AKRA.JK', name: 'AKR Corporindo Tbk', sector: 'Distribusi Energi' },
];

export const IDX_SYMBOL_MAP = new Map<string, IdxStockMeta>(
  IDX_UNIVERSE.map((item) => [item.symbol, item])
);

/**
 * Aturan Fraksi Harga (Tick Size) resmi Bursa Efek Indonesia (BEI):
 * < Rp 200      : Rp 1
 * Rp 200 - <500 : Rp 2
 * Rp 500 - <2000: Rp 5
 * Rp 2000 -<5000: Rp 10
 * >= Rp 5000    : Rp 25
 */
export function getBeiTickSize(price: number): number {
  if (price < 200) return 1;
  if (price < 500) return 2;
  if (price < 2000) return 5;
  if (price < 5000) return 10;
  return 25;
}

/**
 * Aturan Auto Rejection Simetris BEI (ARA & ARB):
 * Rp 50 - Rp 200   : +/- 35%
 * > Rp 200 - 5000  : +/- 25%
 * > Rp 5000        : +/- 20%
 */
export function getBeiAraLimitPct(price: number): number {
  if (price <= 200) return 35;
  if (price <= 5000) return 25;
  return 20;
}

export function roundToBeiTick(price: number, mode: 'nearest' | 'floor' | 'ceil' = 'nearest'): number {
  const safePrice = Math.max(50, price);
  const tick = getBeiTickSize(safePrice);
  if (mode === 'floor') return Math.max(50, Math.floor(safePrice / tick) * tick);
  if (mode === 'ceil') return Math.max(50, Math.ceil(safePrice / tick) * tick);
  return Math.max(50, Math.round(safePrice / tick) * tick);
}

export function normalizeIdxSymbol(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/\.JK$/, '');
  if (!/^[A-Z0-9]{4}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}
