const nf0 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const n0 = (v: number | null | undefined) => (v == null ? "–" : nf0.format(v));
export const n1 = (v: number | null | undefined) => (v == null ? "–" : nf1.format(v));
export const n2 = (v: number | null | undefined) => (v == null ? "–" : nf2.format(v));
export const pct = (v: number | null | undefined, digits = 1) => {
  if (v == null) return "–";
  const s = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(v) * 100);
  return `${v < 0 ? "-" : ""}%${s}`;
};

/** Milyon TL → okunur metin. */
export function mtl(v: number | null | undefined): string {
  if (v == null) return "–";
  const b = Math.abs(v) / 1000;
  if (b >= 100) return `${nf0.format(v / 1000)} mr ₺`;
  if (b >= 1) return `${nf2.format(v / 1000)} mr ₺`; // maliyet farkları ~%0,1 düzeyinde, iki hane gerekli
  return `${nf0.format(v)} mn ₺`;
}

export function compact(v: number): string {
  if (Math.abs(v) >= 1e6) return `${nf2.format(v / 1e6)} mn`;
  if (Math.abs(v) >= 1e3) return `${nf1.format(v / 1e3)} bin`;
  return nf0.format(v);
}

export const statusLabel: Record<string, string> = {
  optimal: "Optimal",
  time_limit: "Zaman limiti",
  infeasible: "Uygun çözüm yok",
  "not solved": "Çözülmedi",
  undefined: "Tanımsız",
};
